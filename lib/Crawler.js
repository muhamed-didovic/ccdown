const fs = require('fs-extra')
const Promise = require('bluebird');
const sanitize = require('sanitize-filename')
const { range } = require('lodash')
const cheerio = require("cheerio");
const { CookieJar } = require('tough-cookie')
const jarGot = require('jar-got')
const urlRegexSafe = require('url-regex-safe');
const fileSize = require("./helpers/fileSize");

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
        const { body } = await jarGot()(`https://ms.codecourse.com/indexes/courses/search`,{
            json   : true,
            headers: {
                'content-type': 'application/json',
                "x-meili-api-key": '319f15d8dc1c683c37495128f2a5d8436a5596d4544e61e549edf4d1555bc1f5'
            },
            body: {
                limit   : 379,
                attributesToHighlight: ["title"],
                q: ""
            }
        })

        // console.log('Limit:', body.hits.length);

        if (!body?.hits.length) {
            return require('../json/search-courses.json')
        }

        const courses = body.hits.map(item => ({
            //id: item.id,
            title:  `${item.id} ${item.title}`,
            value: item.url ? item.url : `https://nova.codecourse.com/courses/${item.slug}`
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
     *
     * @param url
     * @returns <string> url
     * @private
     */
    async _vimeoRequest(url) {
        let { body } = await this._got(`${url}`, {
            headers: {
                'Referer': 'https://codecourse.com/'
            }
        })

        //scrape for a video
        let videos = body
            .match(urlRegexSafe())
            .filter(url => url.includes('https://vod-progressive.akamaized.net'))

        //find the biggest videos
        return await Promise
            .map(videos, async url => {
                let size = await fileSize({
                    'method' : 'GET',
                    'url'    : url,
                    'headers': {
                        'Referer': 'https://codecourse.com/'
                    }
                })
                // console.log('Size', url, size);
                return {
                    url,
                    size
                };
            })
            .then(this.findBestVideo)
    };

    findBestVideo(videosArray) {
        let max = Math.max(...videosArray.map(v => v.size))
        return (videosArray.find(o => o.size === max))['url']
    }

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
     */
    async getAllCourses(opts) {
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
                                let json = await this._request({ url: `${this.url}/subjects/${subject.slug}/index?page=${index}` })
                                return json?.props?.courses?.data;
                            })
                            .then(c => c.flat())
                    })
                    .then(c => c.flat());

            })
            .then(async (courses) => {
                // console.log('courses length', courses.length);
                return await Promise
                    .map(courses, async (course) => {
                        let { body: seriesResponse } = await this._got(`${this.url}/courses/${course.slug}`, {
                            json   : true,
                            headers: {
                                'x-inertia-version'          : this.version,
                                'x-inertia'                  : 'true',
                                'x-inertia-partial-component': 'Course',
                                'x-inertia-partial-data'     : 'parts'
                            }
                        })
                        opts.logger.info(`${course.slug} has ${seriesResponse.props.parts.data.length} videos`);
                        //add additional info for courses
                        return seriesResponse.props.parts.data.map(s => {
                            s.series = {
                                id   : course.id,
                                title: course.title,
                                slug : course.slug
                            }

                            return s;
                        })

                    }, {
                        concurrency: opts.concurrency
                    })
                    .then(c => c.flat())
            })
            .then(async courses => {
                // extract videos and sanitize
                return await Promise.map(courses, async (course) => await this.extractVideos(course));
            });
    }

    /**
     *
     * @param url
     * @returns {bluebird<*>}
     */
    async getSingleCourse(url) {
        return Promise
            .resolve()
            .then(async () => {
                //get the chapters or videos from requests
                let json = await this._request({ url })
                let { data } = json.props.course;
                return data;
            })
            .then(async (course) => {
                let seriesResponse = await this._request({ url: `${this.url}/watch/${course.slug}` })

                //add additional info for courses
                return seriesResponse.props.parts.data.map(s => {
                    s.series = {
                        id   : course.id,
                        title: course.title,
                        slug : course.slug
                    }
                    return s;
                })
            })
            .then(async courses => {
                // extract videos and sanitize
                return await Promise.map(courses, async (course) => await this.extractVideos(course));
            });
    }

    /**
     *
     * @param course
     * @returns {bluebird<{series: string, downPath: string, position: number | string, title: string, url: string}>}
     */
    async extractVideos(course) {
        let url = `https://player.vimeo.com/video/${course.video.vimeo_id}?h=93dc93917d&title=0&byline=0&app_id=122963`
        let series = sanitize(course.series.title)
        let position = course.order
        let title = sanitize(`${String(position - 1).padStart(2, '0')}-${course.slug}.mp4`)
        let downPath = `${course.series.id}-${series}`
        return {
            series,
            url,
            title,
            position,
            downPath
        }

    }
}

