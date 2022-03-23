const fs = require('fs-extra')
const Promise = require('bluebird');
const sanitize = require('sanitize-filename')
const { range, orderBy, some } = require('lodash')
const cheerio = require("cheerio");
const { CookieJar } = require('tough-cookie')
const jarGot = require('jar-got')
const urlRegexSafe = require('url-regex-safe');
const json2md = require("json2md")

const fileSize = require("./helpers/fileSize");
const { formatBytes } = require('./helpers/writeWaitingInfo')

const ytdl = require('ytdl-run')
const { PromisePool } = require('@supercharge/promise-pool')
const path = require("path");


module.exports = class Crawler {

    url = "https://codecourse.com"
    version = ''
    _got = ''

    /**
     * @param got
     * @param inertiaVersion
     */
    constructor(got = jarGot(), version = 'noop') {
        this._got = got
        this.version = version
    }

    static async getCourses(opts) {
        const { body } = await jarGot()(`https://ms.codecourse.com/indexes/courses/search`, {
            json   : true,
            headers: {
                'content-type'   : 'application/json',
                "x-meili-api-key": '319f15d8dc1c683c37495128f2a5d8436a5596d4544e61e549edf4d1555bc1f5'
            },
            body   : {
                limit                : 379,
                attributesToHighlight: ["title"],
                q                    : ""
            }
        })

        // console.log('Limit:', body.hits.length);

        if (!body?.hits.length) {
            return require('../json/search-courses.json')
        }

        const courses = body.hits.map(item => ({
            //id: item.id,
            title: `${item.id} ${item.title}`,
            value: item.url ? item.url.replace('nova.', '') : `https://codecourse.com/courses/${item.slug}`//`https://nova.codecourse.com/courses/${item.slug}`
        }));

        fs.writeFileSync(`./json/search-courses.json`, JSON.stringify(courses, null, 2), 'utf8')
        return courses;
    }

    /**
     *
     * @param saved
     * @param version
     * @returns {Crawler}
     */
    static restore(saved, version) {
        return new Crawler(jarGot(CookieJar.deserializeSync(saved)), version);
    }

    /**
     *
     */
    save() {
        return this._got.jar.serializeSync();
    }

    /**
     *
     * @param opts
     * @returns {bluebird<Crawler>}
     */
    async login(opts) {
        //console.log('opts', `${this.url}/login`, opts);

        //get necessary tokens
        const { sanitizeXsrfToken, cookie, version } = await this.getTokensForLogin();

        const post = await this._got.post(`${this.url}/login`, {
            throwHttpErrors: false,
            // followRedirect: true,
            // form          : true,
            headers: {
                'content-type': 'application/json',
                "x-xsrf-token": sanitizeXsrfToken,
                "cookie"      : cookie
            },
            body   : JSON.stringify({
                email   : opts.email,
                password: opts.password,
                remember: true
            })
        })

        //save cookies
        let saved = this.save();

        //return new instance of crawler with cookies and inertia version
        return Crawler.restore(saved, version);
    }

    /**
     *
     * @returns {bluebird<{cookie: string, sanitizeXsrfToken: string, version: *}>}
     */
    async getTokensForLogin() {
        const { body, headers } = await this._got(`${this.url}/auth/signin`)
        const $ = cheerio.load(body)
        const { version } = JSON.parse($('#app').attr('data-page'))
        let [xsrfToken, codecourseSession] = headers['set-cookie']
        let cookie = `${xsrfToken.split('%3D;')[0] + '%3D;'} ${codecourseSession.split('%3D;')[0] + '%3D;'}`
        let sanitizeXsrfToken = (xsrfToken.split('XSRF-TOKEN=')[1]).split('%3D;')[0] + "="

        return {
            sanitizeXsrfToken,
            cookie,
            version
        };
    };

    /**
     * @param {any} opts
     */
    async _request(opts) {

        let { body } = await this._got(opts.url, {
            json   : true,
            headers: {
                'x-inertia-version': this.version,
                'x-inertia'        : 'true'
            }
        })
        return body;
    };

    /**
     *
     * @returns {bluebird<*>}
     * @param {*&{ms: Spinnies}} opts
     */
    async getAllCourses(opts) {
        const { ms, dir } = opts;
        ms.add('info', { text: `get courses from ${this.url}/subjects` });
        return Promise
            .resolve()
            .then(async () => {
                let json = await this._request({ url: `${this.url}/subjects` })
                return json.props.subjects.data;
            })
            .then(async subjects => {
                return await Promise
                    .map(subjects, async (subject) => {
                        let round = Math.ceil(subject.courses_count/7)
                        const r = range(1, ++round);
                        return await Promise
                            .map(r, async index => {
                                ms.update('info', { text: `scraping... ${this.url}/subjects/${subject.slug}/index?page=${index}` });
                                let json = await this._request({ url: `${this.url}/subjects/${subject.slug}/index?page=${index}` })
                                return json?.props?.courses?.data;
                            })
                            .then(c => c.flat())
                    })
                    .then(c => c.flat());

            })
            .then(async (courses) => {
                // console.log('courses length', courses.length);
                let i = 1;
                return await Promise
                    .map(courses, async (course, index) => {
                        // ms.update('info', { text: `Before request course: ${this.url}/courses/${course.slug}` });
                        let { body: seriesResponse } = await this._got(`${this.url}/watch/${course.slug}`, {
                            json   : true,
                            headers: {
                                'x-inertia-version'          : this.version,
                                'x-inertia'                  : 'true',
                                'x-inertia-partial-component': 'Course',
                                'x-inertia-partial-data'     : 'parts'
                            }
                        })

                        const [, res] = await Promise.all([
                            this.createMarkdown(seriesResponse.props, dir, `${this.url}/watch/${course.slug}`),
                            (async () => {
                                ms.update('info', { text: `Extracting ${++i}/${courses.length} course: ${course.slug} has ${seriesResponse.props.parts.data.length} episodes` });
                                return seriesResponse.props.parts.data.map(s => {
                                    //add additional info for courses
                                    s.series = {
                                        id   : course.id,
                                        title: course.title,
                                        slug : course.slug
                                    }


                                    return this.extractVideos({
                                        course: s,
                                        ms,
                                        index,
                                        total : 0
                                    });
                                })
                            })(),
                        ])
                        return res;

                        /*await this.createMarkdown(seriesResponse.props, dir, `${this.url}/watch/${course.slug}`);
                        return seriesResponse.props.parts.data.map(s => {
                            //add additional info for courses
                            s.series = {
                                id   : course.id,
                                title: course.title,
                                slug : course.slug
                            }


                            return this.extractVideos({
                                course: s,
                                ms,
                                index,
                                total : 0
                            });
                        })*/

                    }, {
                        concurrency: opts.concurrency
                    })
                    .then(c => c.flat())
            })
            .then(async (courses) => {
                ms.succeed('info', { text: `Extraction is done for ${courses.length} videos from courses` });
                return courses;
                //await this.makeConcurrentCalls(courses, ms)
            });
    }

    /**
     *
     * @param url
     * @param ms
     * @param dir
     * @returns {bluebird<*>}
     */
    async getSingleCourse({ url, ms, dir }) {
        ms.add('info', { text: `Get course: ${url}` });
        return Promise
            .resolve()
            .then(async () => {
                //get the chapters or videos from requests
                let { props } = await this._request({ url })

                // let series = sanitize(course.series.title)


                //console.log('data', props.parts.data);
                // props.parts.data.map(i => console.log('vimeo', i.video.vimeo_id))


                await this.createMarkdown(props, dir, url);
                return props;
            })
            .then(async ({ course: { data }, parts }) => {
                // console.log('course', data);
                /* return parts.data.map(s => {
                   s.series = {
                     id   : data.id,
                     title: data.title,
                     slug : data.slug
                     //parts:
                   }
                   return s;
                 })*/

                ms.update('info', { text: `Extracting course: ${data.slug} has ${parts.data.length} episodes` });
                return parts.data.map(s => {
                    s.series = {
                        id   : data.id,
                        title: data.title,
                        slug : data.slug
                    }

                    //return s;
                    return this.extractVideos({
                        course: s,
                        ms,
                        index : 0,
                        total : 0
                    });
                })
            })
        //.then(async (courses) => await this.makeConcurrentCalls(courses, ms));
    }

    async createMarkdown(props, dir, url) {
        /*"resources": [
            {
                "id": 299,
                "title": "Booking calendar markup",
                "free": false
            }
        ],
            "codes": [
            {
                "id": 300,
                "title": "Livewire booking system",
                "free": false
            }
        ],*/

        //https://codecourse.com/files/299/download?from=/watch/build-a-booking-system-with-livewire?part=introduction-and-demo-booking-system-livewire
        //https://codecourse.com/files/300/download?from=/watch/build-a-booking-system-with-livewire?part=introduction-and-demo-booking-system-livewire

        if(!props?.course?.data) {
            console.log('NO PROPS FOUND', url);
            console.log('-----', props);
            return;
        }

        //save resources into md
        const course = props.course.data
        const md = json2md([
            { h1: "Resources" },
            { h2: "Description" },
            { p: course.description },
            {
                link: [
                    ...(course?.resources &&
                        [course.resources.map(c => ({
                            'title' : c.title,
                            'source': `https://codecourse.com/files/${c.id}/download`
                        }))]
                    ),
                    ...(course?.codes && [
                        course.codes.map(c => ({
                            'title' : c.title,
                            'source': `https://codecourse.com/files/${c.id}/download`
                        }))
                    ])
                ]
            }
        ])
        let downPath = `${course.id}-${sanitize(course.title)}`
        const dest = path.join(dir, downPath)
        // console.log('dest', path.join(dir, downPath));
        await fs.ensureDir(dest)
        await fs.writeFileSync(path.join(dir, downPath, `${url.split('/').pop()}.md`), md, 'utf8')//-${Date.now()}
    }

    async makeConcurrentCalls(courses, ms) {
        // extract videos and sanitize
        const total = courses.length;
        ms.update('info', { text: `Start extracting  ${total} videos from found courses ` });

        const { results, errors } = await PromisePool
            // .withConcurrency(2)
            .for(courses)
            .handleError(async (error, course, pool) => {
                // if (error instanceof SomethingBadHappenedError) {
                //     return pool.stop()
                // }
                console.error('POOL error::', error);
            })
            .process(async (course, index, pool) => {
                /*if (condition) {
                    return pool.stop()
                }*/
                // console.log('course:', course);

                const videos = await this.extractVideos({
                    course,
                    ms,
                    index,
                    total
                });

                return videos
            })
        ms.succeed('info', { text: `Extraction is done` });

        return results;
    }

    /**
     *
     * @param course
     * @param ms
     * @param index
     * @param total
     * @returns {bluebird<{series: string, downPath: string, position: number | string, title: string, url: string}>}
     */
    extractVideos({ course, ms, index, total }) {
        //console.log('course', course);
        // console.log('course.download', course.video.has_download, course.video.vimeo_id);
        let vimeoUrl = `https://player.vimeo.com/video/${course?.video?.vimeo_id}?h=93dc93917d&title=0&byline=0&app_id=122963`
        if (!course?.series?.title || !course?.video?.vimeo_id) {
            console.log('---series:', course)
        }
        let series = sanitize(course.series.title)
        let position = course.order
        let title = sanitize(`${String(position - 1).padStart(2, '0')}-${course.slug}.mp4`)
        let downPath = `${course.series.id}-${series}`
        let url = `https://codecourse.com/parts/${course.slug}/download`
        // ms.update('info', { text: `Extracting: ${index}/${total} series ${series} - episode ${title}` });

        return {
            series,
            ...(course.video.has_download && { url }),
            title,
            position,
            downPath,
            vimeoUrl
        }
    }

    /**
     *
     * @param course
     * @returns <string> url
     * @private
     */
    async _vimeoRequest(course) {
        const vimeoUrl = course.vimeoUrl


        //check if we have 1920 video size
        /*let info = await ytdl.getInfo([
            '--referer', "https://codecourse.com/",
            url
        ])*/
        // console.log('info', info.requested_formats);


        /*let urlForSize = await Promise
            .map(info.requested_formats.filter(f => f.format_note === 'DASH video'), async v => {
                let size = await fileSize({
                    'method': 'HEAD',
                    'url'   : v.url,
                    // 'Referer': 'https://app.egghead.io/'
                })
                // console.log('szie;', formatBytes(size), v.url);
                // console.log('vvvv;', v);
                return {
                    url: v.url,
                    size
                };
            })
            .then((videosArray) => {
                let max = Math.max(...videosArray.map(v => v.size))
                return (videosArray.find(o => o.size === max))['url']
            })*/

        let { body } = await this._got(`${vimeoUrl}`, {
            headers: {
                'Referer': 'https://codecourse.com/'
            }
        })
        const $ = cheerio.load(body)
        // const s = $('script:contains("f.vimeocdn.com")').html()

        const [, config] = /var config = (.*)\; if \(\!config.request\)/.exec(body)
        let json = JSON.parse(config)
        const formats = json.request.files.progressive;
        //json = orderBy(formats , ['width'], ['desc'] )

        if (course.url && !some(formats, v => v.quality === '1920p')) {
            // console.log('get download link from page', course.url);
            const { body } = await this._got(course.url, {
                followRedirect: false
            })
            const $ = cheerio.load(body)
            const link = $('a').attr('href')
            // console.log('link', link);

            // const s = await this._got(course.url, { method: 'HEAD' })
            // console.log('ss', s.headers);

            return {
                url : link,
                size: null
            }
        }

        const v = orderBy(formats, ['width'], ['desc'])[0].url
        let size = await fileSize({
            'method' : 'GET',
            'url'    : v,
            'headers': {
                'Referer': 'https://codecourse.com/'
            }
        })
        // console.log('Size', course.title, formatBytes(size));
        return {
            url: v,
            size
        };
    };

    findBestVideo(videosArray) {
        let max = Math.max(...videosArray.map(v => v.size))
        return (videosArray.find(o => o.size === max))
    }
}

