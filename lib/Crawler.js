const fs = require('fs-extra')
const sanitize = require('sanitize-filename')
const path = require("path");
const { range, orderBy, uniqBy } = require('lodash')
const cheerio = require("cheerio")
const ufs = require("url-file-size");
// const { CookieJar } = require('tough-cookie')
// const jarGot = require('jar-got')
const json2md = require("json2md")

// const fileSize = require("./helpers/fileSize");
// const { formatBytes } = require('./helpers/writeWaitingInfo')

// const ytdl = require('ytdl-run')
const { PromisePool } = require('@supercharge/promise-pool')
const downOverYoutubeDL = require("./helpers/downOverYoutubeDL");

const pRetry = require('@byungi/p-retry').pRetry
const pDelay = require('@byungi/p-delay').pDelay


const req = require('requestretry');
const { formatBytes } = require("./helpers/writeWaitingInfo");
const retry = require("./helpers/retry");
const j = req.jar();
const request = req.defaults({ jar: j, retryDelay: 500, fullResponse: true });


module.exports = class Crawler {

    url = "https://codecourse.com"
    version = ''
    xsrfToken = ''
    _reg = ''

    /**
     * @param version
     */
    constructor(version = 'noop') {
        this.version = version
        //this._got = got
        this._req = request
    }

    static async getCourses(searchFromLocalFile) {
        // if (!body?.hits.length) {
        if (searchFromLocalFile && await fs.exists(path.resolve(__dirname, '../json/search-courses.json'))) {
            console.log('LOAD FROM LOCAL SEARCH FILE');
            return require(path.resolve(__dirname, '../json/search-courses.json'))
        }

        const options = {
            //json     : true,
            'method' : 'POST',
            'url'    : 'https://ms.codecourse.com/indexes/courses/search',
            'headers': {
                'Content-Type' : 'application/json',
                "authorization": "Bearer 5zPBPfuQef74379e3ddb3b4dba218339f8f20c2cb70e564279121a59fca4bb6c9f6af43f",
            },
            body     : JSON.stringify({
                "limit"                : 400,
                "attributesToHighlight": [
                    "title"
                ],
                "q"                    : ""
            })

        };
        let { body } = await request(options)

        body = JSON.parse(body)
        console.log('Found:', body?.hits?.length);

        const courses = body.hits
            .sort((a, b) => b.id - a.id)
            .map(item => ({
                //id: item.id,
                title: `${item.id} ${item.title}`,
                value: item.url ? item.url.replace('nova.', '') : `https://codecourse.com/courses/${item.slug}`//`https://nova.codecourse.com/courses/${item.slug}`
            }))

        await fs.ensureDir(path.resolve(__dirname, '../json'))
        await fs.writeFile(path.resolve(__dirname, `../json/search-courses.json`), JSON.stringify(courses, null, 2), 'utf8')
        return courses;
    }

    async logout(opts) {
        let post = await this._request({ url: `${this.url}/logout` })//

        if (post.statusCode !== 302) {
            throw new Error('User is not logged')
        }
    }

    /**
     *
     * @param opts
     * @returns {bluebird<Crawler>}
     */
    async login(opts) {
        //get necessary tokens
        const { sanitizeXsrfToken, cookie, version } = await this.getTokensForLogin();
        // console.log({ sanitizeXsrfToken, cookie, version });
        const post = await this._req.post(`${this.url}/login`, {
            throwHttpErrors: false,
            followRedirect : true,
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
            }),
        })
        // console.log('body', post.statusCode, post.body);

        const regex = /<title>Redirecting to https:\/\/codecourse.com<\/title>/gm
        let res = regex.exec(post.body);
        // console.log('res', res);

        if (res) {//post.statusCode === 302
            return this;
        } else {
            throw new Error('User is not logged')
        }
    }

    /**
     *
     * @returns {bluebird<{cookie: string, sanitizeXsrfToken: string, version: *}>}
     */
    async getTokensForLogin() {
        const { body, headers } = await this._req(`${this.url}/auth/signin`)
        const $ = cheerio.load(body)
        const { version } = JSON.parse($('#app').attr('data-page'))
        let [xsrfToken, codecourseSession] = headers['set-cookie']
        let cookie = `${xsrfToken.split('%3D;')[0] + '%3D;'} ${codecourseSession.split('%3D;')[0] + '%3D;'}`
        let sanitizeXsrfToken = (xsrfToken.split('XSRF-TOKEN=')[1]).split('%3D;')[0] + "="
        this.xsrfToken = sanitizeXsrfToken;
        this.version = version
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
        try {
            let { body } = await this._req({
                //'rejectUnauthorized': false,
                json   : true,
                headers: {
                    'x-inertia-version': this.version,
                    'x-inertia'        : 'true',
                    // 'x-xsrf-token': this.xsrfToken
                },
                ...opts
            })
            return body;
        } catch (e) {
            console.error(`ERROR REQUESt url: ${opts.url}`, e);
            return;
        }
    };

    /**
     * @template T
     * @param {()=>Promise<T>} runner
     */
    async slowForever(runner) {
        const [res] = await Promise.all([pRetry(runner, { retries: Infinity, interval: 30000 }), pDelay(10000)])
        return res
    }


    /**
     * Helper functions to get a random item from an array
     * @param array
     * @returns {*}
     */
    sample = array => array[Math.floor(Math.random()*array.length)];

    /**
     *
     * @returns {bluebird<*>}
     * @param {*&{ms: Spinnies}} opts
     */
    async getAllCourses(opts) {
        const { ms, dir, concurrency } = opts;
        //ms.add('markdown', { text: `Markdown started...` });
        ms.add('info', { text: `get courses from ${this.url}/subjects` })

        return Promise
            .resolve()
            .then(async () => {
                let json = await this._request({ url: `${this.url}/subjects` })//
                return json.props.topics.data;//.slice(7, 8);
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
                ms.succeed('info', { text: `Found: ${courses.length} courses` });
                let i = 1;
                return await Promise
                    .map(courses, async (course, index) => {
                        ms.add(course.slug, { text: `extracting course ${course.slug}` })
                        let seriesResponse = await this._request({
                                url: `${this.url}/watch/${course.slug}`,
                                /*headers: {
                                    'x-inertia-version'          : this.version,
                                    'x-inertia'                  : 'true',
                                    'x-inertia-partial-component': 'Course',
                                    'x-inertia-partial-data'     : 'parts',
                                }*/
                            }
                        )

                        if (!seriesResponse?.props?.course?.data) {
                            console.log('NO PROPS FOUND for url:', `${this.url}/watch/${course.slug}`);
                            console.log('NO PROPS seriesResponse response:', seriesResponse);
                            return;
                        }
                        // return await this.slowForever(async () => await this.extractData(seriesResponse, opts, course, i++, 'courses', courses))
                        return await this.extractData(seriesResponse, opts, course, i++, 'courses', courses)
                    }, {
                        concurrency: 1
                    })
                    .then(c => {
                        return c.flat()
                    })
            })
            .then(async (courses) => {
                //ms.succeed('markdown', { text: `Markdown is done...` });
                // ms.succeed('info', { text: `Extraction is done for ${courses.length} videos from courses` });
                return courses;
            });
    }

    async extractData(seriesResponse, opts, course, i, prefix, courses = []) {
        const { ms, dir, concurrency, logger } = opts;
        let c = 0;
        const [, res] = await Promise.all([
            (async () => {
                await this.createMarkdown(seriesResponse.props, ms, dir, `${this.url}/watch/${course.slug}`);
                //ms.update(course.slug, { text: `Markdown building for ${course.slug}.md` });
            })(),
            (async () => {
                ms.update(course.slug, { text: `Extracting ${i}/${courses.length} course: ${course.slug} has ${seriesResponse?.props?.parts?.data?.length} episodes` });
                const r = await Promise
                    .map(seriesResponse.props.parts.data, async (s) => {
                        // console.log('2222222:', `${this.url}/watch/${s.course_slug}?part=${s.slug}`);
                        ms.update(course.slug, { text: `Extracting ${i}/${courses.length} course: ${course.slug} has ${i++}/${seriesResponse?.props?.parts?.data?.length} episodes, scraping url: ${this.url}/watch/${s.course_slug}?part=${s.slug}` });
                        const body = await this._request({ url: `${this.url}/watch/${s.course_slug}?part=${s.slug}` })
                        if (body === 'error code: 1015') {
                            console.log('eeeeee', body);
                            throw new Error('ERROR 1015: limit reached');
                        }
                        let { props: { currentPart } } = body;

                        s.video = currentPart.data.video.data
                        s.series = {
                            id   : course.id,
                            title: course.title,
                            slug : course.slug
                        }

                        const r = this.extractVideos({
                            course: s,
                            ms,
                            index : 0,
                            total : 0
                        });
                        // console.log('rrrrr', r);
                        //const prefix = 'courses'
                        const filename = `${prefix}-${new Date().toISOString()}.json`
                        await this.d(filename, prefix, [r], opts, ++c);

                        return r;
                    }, {
                        concurrency//: 1
                    })
                ms.succeed(course.slug, { text: `${--i}/${courses.length}  Finished scraping course: ${this.url}/watch/${course.slug}` });
                return r;
            })(),
        ])

        // console.log('1res', res.length);
        // console.log('2res', res);
        /*const prefix = 'courses'
        const filename = `${prefix}-${new Date().toISOString()}.json`
        await this.d(filename, prefix, res, opts);*/

        return res;
    }

    /**
     *
     * @param url
     * @param ms
     * @param dir
     * @param concurrency
     * @returns {bluebird<*>}
     */
    async getSingleCourse(opts) {
        const { url, ms, dir, concurrency } = opts;
        // ms.add('info', { text: `Get course: ${url}` });
        // ms.add('markdown', { text: `Markdown started...` });
        return Promise
            .resolve()
            .then(async () => {
                //get the chapters or videos from requests
                let body = await this._request({ url })
                if (body === 'error code: 1015') {
                    throw new Error('ERROR 1015: limit reached');
                }
                return body;
            })
            .then(async (body) => {
                if (body === undefined || !body?.props?.course) {
                    throw new Error(`PROPS ARE UNDEFINED, check if there are any lessons for: ${url}`);
                }
                ms.add(url, { text: `extracting course ${url}` })
                // console.log('tu smo', body);
                const course = {
                    slug : url,
                    title: body.props.course.data.title,
                    id   : body.props.course.data.id,
                    // course_slug: body.props.course.data.id
                }
                // return await this.slowForever(async () => await this.extractData(body, opts, course, 1, 'single-course', body.props.parts.data))
                return await this.extractData(body, opts, course, 1, 'single-course', body.props.parts.data)
                /*const [, res] = await Promise.all([
                    (async () => {
                        await this.createMarkdown(props, ms, dir, url);
                        ms.update('markdown', { text: `Markdown building for ${props.course.data.slug}.md` });
                    })(),
                    (async () => {
                        const { course: { data }, parts } = props;
                        ms.update('info', { text: `Extracting course: ${data.slug} has ${parts.data.length} episodes` });
                        // console.log('props', parts.data);

                        //basic info, we need vimeo id
                        // https://codecourse.com/watch/the-eloquent-query-method?part=visual-appeal
                        /!*{
                            "id": 4371,
                            "title": "Passing a Builder around",
                            "slug": "passing-a-builder-around",
                            "free": true,
                            "order": 7,
                            "duration": "06:43",
                            "new": false,
                            "course_slug": "the-eloquent-query-method"
                        }*!/
                        let counter = 0;
                        return await Promise.map(parts.data, async (s) => {
                            // console.log('curent part:', `${this.url}/watch/${s.course_slug}?part=${s.slug}`);
                            let body = await this._request({ url: `${this.url}/watch/${s.course_slug}?part=${s.slug}` })
                            if (body === 'error code: 1015') {
                                throw new Error(`ERROR 1015: limit reached, counter reached: ${counter}!!!`);
                            }
                            let { props: { currentPart } } = body;
                            s.video = currentPart.data.video.data
                            s.series = {
                                id   : data.id,
                                title: data.title,
                                slug : data.slug
                            }
                            return this.extractVideos({
                                course: s,
                                ms,
                                index : ++counter,
                                total : parts.data.length
                            })

                        }, {
                            concurrency// : 1
                        })

                        /!* return parts.data.map(s => {
                             s.series = {
                                 id   : data.id,
                                 title: data.title,
                                 slug : data.slug
                             }
                             return this.extractVideos({
                                 course: s,
                                 ms,
                                 index : 0,
                                 total : 0
                             });
                         })*!/

                    })(),
                ])
                return res;*/
            })
            .then(async (courses) => {
                // ms.succeed('markdown', { text: `Markdown is done...` });
                // ms.succeed('info', { text: `Extraction is done for ${courses.length} videos from courses` });
                return courses;
                //await this.makeConcurrentCalls(courses, ms)
            });
        //.then(async (courses) => await this.makeConcurrentCalls(courses, ms));
    }

    /**
     * "resources": [
     *  {
     *     "id": 299,
     *     "title": "Booking calendar markup",
     *     "free": false
     *  }
     *         ],
     * "codes": [
     *  {
     *     "id": 300,
     *     "title": "Livewire booking system",
     *     "free": false
     *  }
     * ]
     * https://codecourse.com/files/299/download?from=/watch/build-a-booking-system-with-livewire?part=introduction-and-demo-booking-system-livewire
     * https://codecourse.com/files/300/download?from=/watch/build-a-booking-system-with-livewire?part=introduction-and-demo-booking-system-livewire
     * @param props
     * @param ms
     * @param dir
     * @param url
     * @returns {bluebird<void>}
     */
    async createMarkdown(props, ms, dir, url) {
        //save resources into md
        const course = props.course.data
        const md = json2md([
            { h1: "Resources" },
            { h2: "Description" },
            { p: course.description },
            {
                link: [
                    ...(course?.resources?.data &&
                        [course?.resources?.data.map(c => ({
                            'title' : c.title,
                            'source': `https://codecourse.com/files/${c.id}/download`
                        }))]
                    ),
                    ...(course?.codes?.data && [
                        course?.codes?.data.map(c => ({
                            'title' : c.title,
                            'source': `https://codecourse.com/files/${c.id}/download`
                        }))
                    ])
                ]
            }
        ])
        let downPath = `${course.id}-${sanitize(course.title)}`
        const dest = path.join(dir, downPath)
        await fs.ensureDir(dest)
        await fs.writeFile(path.join(dir, downPath, `${url.split('/').pop()}.md`), md, 'utf8')//-${Date.now()}
    }

    /*async makeConcurrentCalls(courses, ms) {
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
                /!*if (condition) {
                    return pool.stop()
                }*!/
                // console.log('course:', course);

                return this.extractVideos({
                    course,
                    ms,
                    index,
                    total
                });
            })
        ms.succeed('info', { text: `Extraction is done` });
        return results;
    }*/

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
            console.log('Isssue with the course:', course)
        }
        let series = sanitize(course.series.title)
        let position = course.order
        // let title = sanitize(`${position}. ${course.title}.mp4`)
        let title = sanitize(`${String(position - 1).padStart(2, '0')}-${course.slug}.mp4`)
        let downPath = `${course.series.id}-${series}`
        let url = `https://codecourse.com/parts/${course.slug}/download`
        // ms.update('info', { text: `Extracting: ${index}/${total} series ${series} - episode ${title}` });

        return {
            series,
            ...(course?.video?.has_download && { url }),
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

        try {
            const v = await retry(async () => {//return
                const { body, attempts } = await request({
                    url        : vimeoUrl,
                    maxAttempts: 50,
                    headers    : {
                        'Referer'   : 'https://codecourse.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/27.0.1453.110 Safari/537.36'
                    }
                })
                if (body.includes('408 Request Time-out')) {
                    console.log('body', vimeoUrl, body);
                    throw new Error('408 ERRROR')
                }
                // console.log('attempts for extractions of video:', attempts);
                return this.findVideoUrl(body, vimeoUrl)

            }, 6, 1e3, true)

            //https://player.vimeo.com/video/788968830?h=93dc93917d&title=0&byline=0&app_id=122963
            // yt-dlp -F "https://player.vimeo.com/video/788968834?h=93dc93917d&title=0&byline=0&app_id=122963" --referer "https://codecourse.com/"
            // youtube-dl --referer "https://codecourse.com/" "https://player.vimeo.com/video/788968830?h=93dc93917d&title=0&byline=0&app_id=122963"
            if (!v) {
                return {
                    size: -1,
                    url : vimeoUrl,
                    vimeoUrl
                }
            }

            const { headers, attempts: a } = await request({
                url         : v,
                json        : true,
                maxAttempts : 50,
                method      : "HEAD",
                fullResponse: true, // (default) To resolve the promise with the full response or just the body
                'headers'   : {
                    'Referer': 'https://codecourse.com/',
                }
            })
            // console.log('headeres', headers);
            if (course?.url) {
                const response = await request({
                    url        : course.url,
                    maxAttempts: 50,
                    method     : "HEAD",
                })
                const size = await ufs(response.request.uri.href)

                // console.log('hhhh', course.url, formatBytes(size), formatBytes(headers['content-length']), '----');
                if (size > headers['content-length']) {
                    return {
                        url: response.request.uri.href,
                        skipVimeoDownload: true,
                        vimeoUrl,
                        size
                    }
                }
            }
            // console.log('>>>>', formatBytes(headers['content-length']), '----');
            return {
                //return here Vimeo url, instead of a particular video('v'), ytdl will get the best one
                url : v,//vimeoUrl, //
                skipVimeoDownload: false,
                vimeoUrl,
                size: headers['content-length']
            };
        } catch (err) {
            console.log('ERR::', err);
            /*if (err.message === 'Received invalid status code: 404') {
                return Promise.resolve();
            }*/
            throw err;
        }
    };

    findBestVideo(videosArray) {
        let max = Math.max(...videosArray.map(v => v.size))
        return (videosArray.find(o => o.size === max))
    }

    findVideoUrl(str, url) {
        const regex =  /(?:\bconfig|window\.playerConfig)\s*=\s*({.+?};?\s*var)/ // /playerConfig = {(.*)}; var/gm
        let res = regex.exec(str);
        let configParsed;
        if (res !== null && typeof res[0] !== "undefined") {
            try {
                // console.log('res', res[1]);
                configParsed = res[1].trim().replace('var', '').trim().replace(/(;\s*$)/g, "");
                // configParsed = configParsed.replace(/(; var\s*$)/g, '');
                // configParsed = configParsed.replace(/(;\s*$)/g, '');
                // console.log('---', configParsed);
                configParsed = JSON.parse(`${configParsed}`);
                let progressive = configParsed.request.files.progressive;

                if (!progressive.length) {
                    // console.log('Noooooooooooooooooooooooooooooooooooooooooooooooo', url);
                    return null;
                }

                // console.log('progressive', url, progressive);
                let video = orderBy(progressive, ['width'], ['desc'])[0];
                // console.log('video', video);
                return video.url;
            } catch (err) {
                console.log('error with findVideoUrl:', url, '-->err:', err);
                console.log('json config:', configParsed);
                console.log('res:', res[1]);
                // await fs.writeFile(path.join(dest, 'markdown', `${course.title}.md`), md, 'utf8')//-${Date.now()}
                // fs.writeFileSync(`./json/test.txt`, res, 'utf8')
                throw err;
            }

        }
        console.log('NO VIDEO FOUND:', url);
        // fs.writeFileSync(`./json/no-config-found-${Date.now()}.txt`, str, 'utf8')
        return null;
    }

    async d(filename, prefix, courses, opts, i) {
        const { file, filePath, ms } = opts

        /*await Promise.all([
            (async () => {
                courses = this.writeVideosIntoFile(file, logger, prefix, courses, filename);

            })(),
            (async () => {
                let cnt = 0
                logger.info(`Starting download with concurrency: ${concurrency} ...`)
                await Promise.map(courses, async (course, index) => {
                    if (course.done) {
                        console.log('DONE for:', course.title);
                        cnt++
                        return;
                    }
                    /!*if (!course.vimeoUrl) {
                        throw new Error('Vimeo URL is not found')
                    }*!/
                    const dest = path.join(opts.dir, course.downPath)
                    fs.ensureDir(dest)

                    const details = await this._vimeoRequest(course)
                    await downOverYoutubeDL(details, path.join(dest, course.title), {
                        downFolder: dest,
                        index,
                        ms
                    })

                    if (file) {
                        courses[index].done = true;
                        await fs.writeFile(filePath, JSON.stringify(courses, null, 2), 'utf8');
                    }
                    cnt++
                }, {
                    concurrency// : 1
                })
                ms.stopAll('succeed');
                logger.succeed(`Downloaded all videos for '${prefix}' api! (total: ${cnt})`)
            })()
        ])*/
        let cnt = 0
        //logger.info(`Starting download with concurrency: ${concurrency} ...`)
        return await Promise.map(courses, async (course, index) => {
            if (course.done) {
                console.log('DONE for:', course.title);
                cnt++
                return;
            }
            /*if (!course.vimeoUrl) {
                throw new Error('Vimeo URL is not found')
            }*/
            const dest = path.join(opts.dir, course.downPath)
            fs.ensureDir(dest)

            const details = await this._vimeoRequest(course)
            await downOverYoutubeDL(details, path.join(dest, course.title), {
                downFolder: dest,
                index     : i,
                ms
            })

            if (file) {
                courses[index].done = true;
                await fs.writeFile(filePath, JSON.stringify(courses, null, 2), 'utf8');
            }
            cnt++
        }, {
            concurrency: 1
        })
        //ms.stopAll('succeed');
        //logger.succeed(`Downloaded all videos for '${prefix}' api! (total: ${cnt})`)
    }

    async writeVideosIntoFile(file, logger, prefix, courses, filename) {
        if (!file) {
            logger.info(`${prefix} - Starting writing to a file ...`)
            //await fs.writeFile(`./json/${filename}`, JSON.stringify(courses, null, 2), 'utf8');
            courses = orderBy(courses, [o => Number(o.downPath.split('-')[0]), 'position'], ['asc', 'asc']);
            courses = uniqBy(courses, 'url');
            await fs.ensureDir(path.resolve(__dirname, '../json'))
            await fs.writeFile(path.resolve(__dirname, `../json/${filename}`), JSON.stringify(courses, null, 2), 'utf8')
            logger.info(`${prefix} - Ended writing to a file ...`)
            // return Promise.resolve()
        }
        // logger.info(`${prefix} - file is used`)
        logger.succeed(`Downloaded all videos for '${prefix}' api! (total: ${courses.length})`)
        // return Promise.resolve()
        return courses;
    }
}

