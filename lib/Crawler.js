import fs from "fs-extra";
import sanitize from "sanitize-filename";
import path from "path";

import * as cheerio from 'cheerio';
import json2md from "json2md";
import { orderBy, range, uniqBy } from "lodash-es";

import ufs from "url-file-size";
import Promise from "bluebird";

import req from "requestretry";

const j = req.jar()
const request = req.defaults({
    jar         : j,
    maxAttempts : 5,   // (default) try 5 times
    retryDelay  : 5000,  // (default) wait for 5s before trying again
    fullResponse: true,
    headers     : {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.125 Safari/537.36'

    }
})

import logger from "./helpers/logger.js";
import retry from "./helpers/retry.js";
import downOverYoutubeDL from "./helpers/downOverYoutubeDL.js";
import { series } from './helpers/search.cjs';

// const { PromisePool } = require('@supercharge/promise-pool')
import { pRetry } from "@byungi/p-retry";
import { pDelay } from "@byungi/p-delay";

// const fileSize = require("./helpers/fileSize");
// const { formatBytes } = require('./helpers/writeWaitingInfo')
// const ytdl = require('ytdl-run')

import { fileURLToPath } from "url";
import downloadCode from "./helpers/downlodCode.cjs";
import FileChecker from "./helpers/fileChecker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export default class Crawler {

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
            logger.log('LOAD FROM LOCAL SEARCH FILE');
            return series;//require(path.resolve(__dirname, '../json/search-courses.json'))
        }

        /*fetch("https://i1vckd5ygq-dsn.algolia.net/1/indexes/!*!/queries?x-algolia-agent=Algolia%20for%20JavaScript%20(4.22.1)%3B%20Browser%20(lite)%3B%20instantsearch.js%20(4.64.0)%3B%20Vue%20(3.4.14)%3B%20Vue%20InstantSearch%20(4.13.4)%3B%20JS%20Helper%20(3.16.1)&x-algolia-api-key=fdc5936fc06ea4311d80145bb5f6f639&x-algolia-application-id=I1VCKD5YGQ", {
            "headers": {
                "accept": "*!/!*",
                "accept-language": "hr-HR,hr;q=0.9,en-US;q=0.8,en;q=0.7,sl;q=0.6,de;q=0.5,tr;q=0.4,sr;q=0.3,ms;q=0.2,bs;q=0.1",
                "cache-control": "no-cache",
                "content-type": "application/x-www-form-urlencoded",
                "pragma": "no-cache",
                "sec-ch-ua": "\"Not A(Brand\";v=\"99\", \"Google Chrome\";v=\"121\", \"Chromium\";v=\"121\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"macOS\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "cross-site",
                "Referer": "https://codecourse.com/",
                "Referrer-Policy": "strict-origin-when-cross-origin"
            },
            "body": "{\"requests\":[{\"indexName\":\"courses\",\"params\":\"facets=%5B%5D&highlightPostTag=__%2Fais-highlight__&highlightPreTag=__ais-highlight__&query=&tagFilters=\"}]}",
            "method": "POST"
        });*/
        const options = {
            //json     : true,
            'method' : 'POST',
            'url'    : 'https://i1vckd5ygq-dsn.algolia.net/1/indexes/*/queries?x-algolia-agent=Algolia%20for%20JavaScript%20(4.22.1)%3B%20Browser%20(lite)%3B%20instantsearch.js%20(4.64.0)%3B%20Vue%20(3.4.14)%3B%20Vue%20InstantSearch%20(4.13.4)%3B%20JS%20Helper%20(3.16.1)&x-algolia-api-key=fdc5936fc06ea4311d80145bb5f6f639&x-algolia-application-id=I1VCKD5YGQ',//https://edge.meilisearch.com/indexes/courses/search',//'https://ms.codecourse.com/indexes/courses/search',
            'headers': {
                'Content-Type' : 'application/json',
                "authorization": "Bearer ac324b1bf39edca268fc9831f23c0d1e4ef4b9a9da809f128c94ada4f5c5d388",
            },
            // body     : JSON.stringify({
            //     "limit"                : 600,
            //     "attributesToHighlight": [
            //         "title"
            //     ],
            //     "q"                    : ""
            // })
            "body": "{\"requests\":[{\"hitsPerPage\":\"1000\",\"indexName\":\"courses\",\"params\":\"facets=%5B%5D&highlightPostTag=__%2Fais-highlight__&highlightPreTag=__ais-highlight__&query=&tagFilters=\"}]}",

        };
        let { body } = await request(options)

        body = JSON.parse(body)?.results?.[0]
        logger.log('Found:', body?.hits?.length);
        if (!body?.hits?.length) {
            logger.log('body:', body);
            throw new Error('No courses found')
        }

        const courses = body.hits
            .sort((a, b) => b.id - a.id)
            .map(item => ({
                id      : item.id,
                id_title: `${ item.id } ${ item.title }`,
                title   : `${ item.title }`,
                value   : item.url ? item.url.replace('nova.', '') : `https://codecourse.com/courses/${ item.slug }`, //`https://nova.codecourse.com/courses/${item.slug}`
                slug    : item.slug,
                url     : item.url ? item.url.replace('nova.', '') : `https://codecourse.com/courses/${ item.slug }`
            }))

        await fs.ensureDir(path.resolve(__dirname, '../json'))
        await fs.writeFile(path.resolve(__dirname, `../json/search-courses.json`), JSON.stringify(courses, null, 2), 'utf8')
        return courses;
    }

    async logout(opts) {
        let post = await this._request({ url: `${ this.url }/logout` })//

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
        // logger.log({ sanitizeXsrfToken, cookie, version });
        const post = await this._req.post(`${ this.url }/login`, {
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
        // logger.log('body', post.statusCode, post.body);

        const regex = /<title>Redirecting to https:\/\/codecourse.com<\/title>/gm
        let res = regex.exec(post.body);
        // logger.log('res', res);

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

        const { body, headers } = await this._req(`${ this.url }/auth/signin`)//
        const $ = cheerio.load(body)
        const { version } = JSON.parse($('#app').attr('data-page'))
        let [xsrfToken, codecourseSession] = headers['set-cookie']
        let cookie = `${ xsrfToken.split('%3D;')[0] + '%3D;' } ${ codecourseSession.split('%3D;')[0] + '%3D;' }`
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
            logger.error(`ERROR REQUESt url: ${ opts.url }`, e);
            return;
        }
    };

    /**
     * @template T
     * @param {()=>Promise<T>} runner
     */
    async slowForever(runner, interval = 30000, delay = 10000) {
        const [res] = await Promise.all([pRetry(runner, { retries: 6, interval }), pDelay(delay)])//retries: Infinity,
        return res
    }


    /**
     * Helper functions to get a random item from an array
     * @param array
     * @returns {*}
     */
    sample = array => array[Math.floor(Math.random() * array.length)];

    /**
     *
     * @returns {bluebird<*>}
     * @param {*&{ms: Spinnies}} opts
     */
    async getAllCourses(opts) {
        const { ms, dir, concurrency, urls } = opts;
        //ms.add('markdown', { text: `Markdown started...` });
        ms.add('info', { text: `Scraping started` })//
        // return this.scrapeCourses(ms)

        return Promise
            .resolve()
            .then(async () => {
                if (urls?.length && urls[0].includes('/subjects/')) {
                    //https://codecourse.com/subjects/flutter/index
                    const url = urls[0]//"https://codecourse.com/subjects/laravel/index";
                    const regex = /\/subjects\/([^/]+)/i;
                    const matches = url.match(regex);
                    const topic = matches && matches[1];
                    logger.info('TOPIC is found:', topic)
                    return await this.scrapeCoursesByTopic(ms, topic)
                }
                ms.update('info', { text: `scraping... get courses from ${ this.url }/subjects` });
                const courses = await Crawler.getCourses(false)
                //let courses =  await this.scrapeCourses(ms)

                // await fs.ensureDir(path.resolve(__dirname, '../json'))
                // await fs.writeFile(path.resolve(__dirname, `../json/courses.json`), JSON.stringify(courses, null, 2), 'utf8')
                // courses = uniqBy(courses, 'url');
                // await fs.writeFile(path.resolve(__dirname, `../json/unique-courses.json`), JSON.stringify(courses, null, 2), 'utf8')
                logger.info(`Found ${courses.length} courses for download`);//, courses
                if (urls?.length) {
                    const filteredObjects = courses.filter(obj => {
                        // if (! obj?.url) {
                        //     console.log('obj.url', obj?.url, 'urls:',urls, obj);
                        //     return false;
                        // }
                        return urls.includes(obj.url)
                    });
                    logger.info('course(s) for download:', filteredObjects);
                    return filteredObjects;
                }

                return courses;
            })
            .then(async (courses) => {
                logger.log('courses::::', courses);
                ms.succeed('info', { text: `Found: ${ courses.length } courses` });
                let i = 1;
                return await Promise
                    .map(courses, async (course) => {
                        ms.add(course.slug, { text: `start sending request for course ${ course.slug }` })
                        logger.info(`start sending request for course URL: ${ this.url }/watch/${ course.slug }`)
                        // const $ = cheerio.load(body)
                        // const d = JSON.parse($('#app').attr('data-page'))
                        // fs.writeJsonSync(path.resolve(__dirname, `../json/app-${ course.slug }.json`), d, { spaces: 2 })
                        let seriesResponse = await this._request({
                                url: `${ this.url }/watch/${ course.slug }`,
                                /*headers: {
                                    'x-inertia-version'          : this.version,
                                    'x-inertia'                  : 'true',
                                    'x-inertia-partial-component': 'Course',
                                    'x-inertia-partial-data'     : 'parts',
                                }*/
                            }
                        )
                        // logger.log('seriesResponse:', seriesResponse);
                        fs.writeFileSync(path.resolve(__dirname, `../json/${ course.slug }.json`), JSON.stringify(seriesResponse, null, 2), 'utf8')

                        if (seriesResponse === 'error code: 1015') {
                            logger.warn(`error code: 1015 for url:${ this.url }/watch/${ course.slug }`)
                            logger.error('ERROR with 1015 seriesResponse', seriesResponse);
                            throw new Error('ERROR 1015: limit reached');
                        }

                        if (!seriesResponse?.props?.course) {//?.data
                            logger.warn('NO PROPS FOUND for url:', `${ this.url }/watch/${ course.slug }`);
                            logger.warn('NO PROPS seriesResponse response:', seriesResponse);
                            logger.error('response:', seriesResponse);
                            return;
                        }
                        ms.update(course.slug, { text: `request done for  course ${ course.slug }` })
                        return await this.slowForever(async () => await this.extractData(seriesResponse, opts, course, i++, 'courses', courses), 30e3, 7e3)//30e3, 10e3
                        // return await this.extractData(seriesResponse, opts, course, i++, 'courses', courses)
                    }, {
                        concurrency: 1
                    })
                    .then(c => {
                        return c.flat()
                    })
            })
            .then(async (courses) => {
                // ms.succeed('info', { text: `Extraction is done for ${courses.length} videos from courses` });
                return courses;
            });
    }

    async scrapeCourses(ms) {
        return Promise
            .resolve()
            .then(async () => {
                let json = await this._request({ url: `${ this.url }/subjects` })//
                return json.props.topics.data;//.slice(7, 8);
            })
            .then(async subjects => {
                return await Promise
                    .map(subjects, async (subject) => {
                        let round = Math.ceil(subject.courses_count / 7)
                        const r = range(1, ++round);
                        return await Promise
                            .map(r, async index => {
                                ms.update('info', { text: `scraping... ${ this.url }/subjects/${ subject.slug }/index?page=${ index }` });
                                let json = await this._request({ url: `${ this.url }/subjects/${ subject.slug }/index?page=${ index }` })
                                return json?.props?.courses?.data;
                            })
                            .then(c => c.flat())
                    })
                    .then(c => c.flat());

            });
    }

    async scrapeCoursesByTopic(ms, topic) {
        const { sanitizeXsrfToken, cookie, version } = await this.getTokensForLogin();
        return Promise
            .resolve()
            .then(async () => {
                let json = await this._request({ url: `${ this.url }/subjects/${ topic }/index` })//
                return json.props.courses;//.slice(7, 8);
            })
            .then(async ({ data, meta }) => {
                const pages = range(2, ++meta.pagination.total_pages);
                /*pagination: {
                    total: 187,
                    count: 7,
                    per_page: 7,
                    current_page: 1,
                    total_pages: 27,
                    links: [Array]
                    }
                }*/

                const courses = await Promise
                    .map(pages, async (index) => {
                        ms.update('info', { text: `scraping... ${ this.url }/subjects/${ topic }/index?page=${ index }` });
                        let json = await this._request({ url: `${ this.url }/subjects/${ topic }/index?page=${ index }` })
                        return json?.props?.courses?.data;
                    })
                    .then(c => c.flat());
                console.log('courses:', courses.length, data.length);
                return [...data, ...courses];
            });
    }

    async extractData(seriesResponse, opts, course, i, prefix, courses = []) {
        const { ms, dir, concurrency, videos } = opts;
        let c = 0;
        const [, res] = await Promise.all([
            (async () => {
                logger.log('[markdown] start')
                await this.createMarkdown(seriesResponse.props, ms, dir, `${ this.url }/watch/${ course.slug }`);
                logger.log('[markdown] end')
            })(),
            (async () => {
                if (videos === 'no') {
                    logger.warn(`No videos will be downloaded for ${ course.slug }`)
                    // ms.succeed(course.slug, { text: `No videos will be downloaded!!! - ${ course.slug }` });
                    ms.remove(course.slug);
                    return;
                }
                // console.log('111111', seriesResponse.props.parts);
                ms.update(course.slug, { text: `Extracting started ${ i }/${ courses.length } course: ${ course.slug } has ${ seriesResponse?.props?.parts?.length } episodes` });
                const r = await Promise
                    .map(seriesResponse.props.episodes, async (s) => {//seriesResponse.props.parts
                        logger.log('2222222:', `${this.url}/watch/${s.course_slug}?part=${s.slug}`);
                        ms.update(course.slug, { text: `Extracting continues ${ i }/${ courses.length } course: ${ course.slug } has ${ i++ }/${ seriesResponse?.props?.episodes?.length } episodes, scraping url: ${ this.url }/watch/${ s.course_slug }?part=${ s.slug }` });
                        const body = await this._request({ url: `${ this.url }/watch/${ s.course_slug }?part=${ s.slug }` })
                        if (body === 'error code: 1015') {
                            logger.warn(`error code: 1015 for url: ${ this.url }/watch/${ s.course_slug }?part=${ s.slug }`)
                            logger.error('ERROR with 1015 body', body);
                            throw new Error('ERROR 1015: limit reached');
                        } else {
                            logger.log('currentEpisode', body?.props?.currentEpisode);//?.video?.data
                        }
                        let { props: { currentEpisode } } = body;

                        /*"currentPart": {
                            "data": { //data is not there any more
                                "id": 4906,
                                "title": "Introduction and demo",
                                "slug": "introduction-and-demo-chunking-large-uploads-in-livewire",
                                "free": true,
                                "order": 1,
                                "duration": "3m 4s",
                                "new": false,
                                "course_slug": "chunking-large-uploads-in-livewire",
                                "vimeo_id": "888686170",
                                "vimeo_hash": "888686170",
                                "has_download": true
                            }
                        },
                        // NEW JSON STRUCTURE OF LESSON
                        {
                            id: 5055,
                            title: 'Playing with Redis sets and HyperLogLog',
                            slug: 'playing-with-redis-sets-and-hyperloglog',
                            free: true,
                            order: 1,
                            duration: '5m 44s',
                            new: false,
                            course_slug: 'logging-unique-views-in-laravel-with-redis',
                            vimeo_id: '911379635',
                            vimeo_hash: '911379635',
                            has_download: true
                          },
                          {
                            id: 5056,
                            title: 'Logging unique views for models',
                            slug: 'logging-unique-views-for-models',
                            free: true,
                            order: 2,
                            duration: '3m 58s',
                            new: false,
                            course_slug: 'logging-unique-views-in-laravel-with-redis',
                            vimeo_id: '911379688',
                            vimeo_hash: '911379688',
                            has_download: true
                          },
                          */

                        s.video = currentEpisode//?.video?.data
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
                        // logger.log('rrrrr', r);
                        //const prefix = 'courses'
                        const filename = `${ prefix }-${ new Date().toISOString() }.json`
                        //downloading the file
                        await this.d(filename, prefix, [r], opts, ++c);

                        return r;
                    }, {
                        concurrency//: 1
                    })
                ms.succeed(course.slug, { text: `${ --i }/${ courses.length }  Finished scraping course: ${ this.url }/watch/${ course.slug }` });
                return r;
            })(),
        ])

        // logger.log('1res', res.length);
        // logger.log('2res', res);
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
                    logger.warn(`error code: 1015 for url: ${ url }`)
                    logger.error('ERROR with 1015 bodyL', body);
                    throw new Error('ERROR 1015: limit reached');
                }
                return body;
            })
            .then(async (body) => {
                if (body === undefined || !body?.props?.course) {
                    throw new Error(`PROPS ARE UNDEFINED, check if there are any lessons for: ${ url }`);
                }
                ms.add(url, { text: `extracting course ${ url }` })
                // logger.log('tu smo', body);
                const course = {
                    slug : url,
                    title: body.props.course.title,
                    id   : body.props.course.id,
                    // course_slug: body.props.course.id
                }
                // return await this.slowForever(async () => await this.extractData(body, opts, course, 1, 'single-course', body.props.parts))
                return await this.extractData(body, opts, course, 1, 'single-course', body.props.parts)
                /*const [, res] = await Promise.all([
                    (async () => {
                        await this.createMarkdown(props, ms, dir, url);
                        ms.update('markdown', { text: `Markdown building for ${props.course.slug}.md` });
                    })(),
                    (async () => {
                        const { course: { data }, parts } = props;
                        ms.update('info', { text: `Extracting course: ${data.slug} has ${parts.length} episodes` });
                        // logger.log('props', parts);

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
                        return await Promise.map(parts, async (s) => {
                            // logger.log('curent part:', `${this.url}/watch/${s.course_slug}?part=${s.slug}`);
                            let body = await this._request({ url: `${this.url}/watch/${s.course_slug}?part=${s.slug}` })
                            if (body === 'error code: 1015') {
                                throw new Error(`ERROR 1015: limit reached, counter reached: ${counter}!!!`);
                            }
                            let { props: { currentPart } } = body;
                            s.video = currentPart.video.data
                            s.series = {
                                id   : data.id,
                                title: data.title,
                                slug : data.slug
                            }
                            return this.extractVideos({
                                course: s,
                                ms,
                                index : ++counter,
                                total : parts.length
                            })

                        }, {
                            concurrency// : 1
                        })

                        /!* return parts.map(s => {
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
        const course = props.course
        logger.log('course:', course.id, course.title, course)
        const resources = course?.resources?.data.map(c => ({
            'title' : c.title,
            'source': `https://codecourse.com/files/${ c.id }/download`
        }))

        const codes = course?.codes?.data.map((item) => ({
            link: {
                title : item.title,
                source: `https://codecourse.com/files/${ item.id }/download`,
            },
        }))
        //https://codecourse.com/courses/authentication-with-laravel-sanctum-and-vue/episodes/introduction-and-demo-sanctum-vue/download
        logger.log('resources:', resources)
        logger.log('codes:', codes)
        logger.log('github:', course?.github_repository)
        const md = json2md([
            { h1: "Resources" },
            { h2: "Description" },
            { p: course?.description },
            ...(course?.resources?.data ? course?.resources?.data?.map((item) => ({
                    link: {
                        title : item.title,
                        source: `https://codecourse.com/files/${ item.id }/download`,
                    },
                })
            ) : []),
            ...(course?.codes?.data ? course?.codes?.data?.map((item) => ({
                    link: {
                        title : item.title,
                        source: `https://codecourse.com/files/${ item.id }/download`,
                    },
                })
            ) : []),
            /*{
                link:
                        // ...(course?.resources?.data
                        //         ?
                        //         [
                        //             uniqBy(course?.resources?.data.map(c => ({
                        //                 'title': c.title,
                        //                 'source': `https://codecourse.com/files/${ c.id }/download`
                        //             })), 'source')
                        //         ]
                        //         : []
                        // ),
                        // ...(course?.codes?.data
                        //     ? [
                        //         uniqBy(course?.codes?.data.map(c => ({
                        //             'title': c.title,
                        //             'source': `https://codecourse.com/files/${ c.id }/download`
                        //         })), 'source')
                        //     ]
                        //     : []
                        // )

            },*/
            // ...(course?.github_repository && [{ h2: "Github:" },{ p: course.github_repository }]),
            ...(course?.github_repository ? ([{ h2: "Github" }, { p: course.github_repository }]) : [])

        ])
        // logger.log('md:', md)
        let downPath = `${ course.id }-${ sanitize(course.title) }`
        const dest = path.join(dir, downPath)
        await fs.ensureDir(dest)
        await fs.writeFile(path.join(dir, downPath, `${ url.split('/').pop() }.md`), md, 'utf8')//-${Date.now()}
        logger.log('Done with writing markdown on path:', dest)
        //download source code
        await Promise.map(course?.resources?.data ?? [], async (c) => {
            const isDownloaded = FileChecker.isCompletelyDownloadedWithOutSize(dest, `https://codecourse.com/files/${ c.id }/download`)
            logger.warn('[markdown] isDownloaded:', isDownloaded !== false, dest)
            if (isDownloaded) {
                return
            }
            logger.log('[markdown] Resource found from resources.data:', c.title, `https://codecourse.com/files/${ c.id }/download`)
            await downloadCode({
                url       : `https://codecourse.com/files/${ c.id }/download`,
                downFolder: dest,
                dest      : path.join(dest, `${ c.title }.zip`)
            })
            logger.info('[markdown] Resource downloaded from resources.data:', c.title, `https://codecourse.com/files/${ c.id }/download`)
        })

        await Promise.map(course?.codes?.data ?? [], async (c) => {
            const isDownloaded = FileChecker.isCompletelyDownloadedWithOutSize(dest, `https://codecourse.com/files/${ c.id }/download`)
            logger.warn('[markdown] isDownloaded:', isDownloaded !== false, dest)
            if (isDownloaded) {
                return
            }
            logger.log('[markdown] Resource found from codes.data:', c.title, `https://codecourse.com/files/${ c.id }/download`)
            await downloadCode({
                url       : `https://codecourse.com/files/${ c.id }/download`,
                downFolder: dest,
                dest      : path.join(dest, `${ c.title }.zip`)
            })
            logger.info('[markdown] Resource downloaded from codes.data:', c.title, `https://codecourse.com/files/${ c.id }/download`)
        })

        if (course?.github_repository) {
            const url = `https://api.github.com/repos/codecourse/${ course.github_repository.split('/').pop() }/zipball`
            const isDownloaded = FileChecker.isCompletelyDownloadedWithOutSize(dest, url)
            logger.warn('[markdown] isDownloaded:', isDownloaded !== false, dest, url)
            if (isDownloaded) {
                return
            }
            logger.log('[markdown] Resource found from Github:', course.title, course.github_repository)
            await downloadCode({
                url,//: `https://api.github.com/repos/codecourse/${ course.github_repository.split('/').pop() }/zipball`,
                downFolder: dest,
                dest      : path.join(dest, `${ course.title }.zip`)
            })
            logger.info('[markdown] Resource downloaded from Github:', course.title, course.github_repository)
        }
        //https://api.github.com/repos/%3Cuser%3E/%3Crepo%3E/zipball
        //https://github.com/codecourse/laravel-passwordless-authentication /archive/refs/heads/main.zip
        //$url = "https://api.github.com/repos/$user/$repo/zipball/master";
        //https://github.com/{user}/{repo}/archive/{branch}.zip

        //https://github.com/codecourse/laravel-passwordless-authentication
        // https://api.github.com/repos/codecourse/laravel-passwordless-authentication/zipball


        //https://files-codecourse.ams3.digitaloceanspaces.com/generatepdf/invoice.php?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=JSB563V2XSINOE3HRIHR%2F20230701%2Fams3%2Fs3%2Faws4_request&X-Amz-Date=20230701T123458Z&X-Amz-SignedHeaders=host&X-Amz-Expires=18000&X-Amz-Signature=d5a4877f52a7ab2aaa99e554aae951215f5732bf42206016c230cc6013cb2218
        //https://files-codecourse.ams3.digitaloceanspaces.com/generatepdf/generatepdf.zip?X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=JSB563V2XSINOE3HRIHR%2F20230701%2Fams3%2Fs3%2Faws4_request&X-Amz-Date=20230701T123725Z&X-Amz-SignedHeaders=host&X-Amz-Expires=18000&X-Amz-Signature=25630e66056a6e8a72263a7be3f624ba0ac3b199e456ab33bc587e7f8b7d0db3
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
                logger.error('POOL error::', error);
            })
            .process(async (course, index, pool) => {
                /!*if (condition) {
                    return pool.stop()
                }*!/
                // logger.log('course:', course);

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
        //logger.log('course', course);
        logger.log('course.download', course?.video?.has_download, course?.video?.vimeo_id);
        if (! course?.video?.vimeo_id) {
            throw new Error(`No video found for the course: ${course.series.title}`)
        }
        // https://player.vimeo.com/video/911379635?title=0&byline=0&app_id=122963
        let vimeoUrl = `https://player.vimeo.com/video/${ course?.video?.vimeo_id }?h=93dc93917d&title=0&byline=0&app_id=122963`
        if (!course?.series?.title || !course?.video?.vimeo_id) {
            logger.log('Isssue with the course:', course)
        }
        let series = sanitize(course.series.title)
        let position = course.order
        // let title = sanitize(`${position}. ${course.title}.mp4`)
        let title = sanitize(`${ String(position - 1).padStart(2, '0') }-${ course.slug }.mp4`)
        let downPath = `${ course.series.id }-${ series }`
        let url = `https://codecourse.com/parts/${ course.slug }/download`
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
                    logger.log('body', vimeoUrl, body);
                    throw new Error('408 ERRROR')
                }
                // logger.log('attempts for extractions of video:', attempts);
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
            // logger.log('headeres', headers);
            if (course?.url) {
                const response = await request({
                    url        : course.url,
                    maxAttempts: 50,
                    method     : "HEAD",
                })
                const size = await ufs(response.request.uri.href)

                // logger.log('hhhh', course.url, formatBytes(size), formatBytes(headers['content-length']), '----');
                if (size > headers['content-length']) {
                    return {
                        url              : response.request.uri.href,
                        skipVimeoDownload: true,
                        vimeoUrl,
                        size
                    }
                }
            }
            // logger.log('>>>>', formatBytes(headers['content-length']), '----');
            return {
                //return here Vimeo url, instead of a particular video('v'), ytdl will get the best one
                url              : v,//vimeoUrl, //
                skipVimeoDownload: false,
                vimeoUrl,
                size             : headers['content-length']
            };
        } catch (err) {
            logger.log('ERR::', err);
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
        const regex = /(?:\bconfig|window\.playerConfig)\s*=\s*({.+?};?\s*var)/ // /playerConfig = {(.*)}; var/gm
        let res = regex.exec(str);
        let configParsed;
        if (res !== null && typeof res[0] !== "undefined") {
            try {
                // logger.log('res', res[1]);
                configParsed = res[1].trim().replace('var', '').trim().replace(/(;\s*$)/g, "");
                // configParsed = configParsed.replace(/(; var\s*$)/g, '');
                // configParsed = configParsed.replace(/(;\s*$)/g, '');
                // logger.log('---', configParsed);
                configParsed = JSON.parse(`${ configParsed }`);
                let progressive = configParsed.request.files.progressive;

                if (!progressive.length) {
                    // logger.log('Noooooooooooooooooooooooooooooooooooooooooooooooo', url);
                    return null;
                }

                // logger.log('progressive', url, progressive);
                let video = orderBy(progressive, ['width'], ['desc'])[0];
                // logger.log('video', video);
                return video.url;
            } catch (err) {
                logger.log('error with findVideoUrl:', url, '-->err:', err);
                logger.log('json config:', configParsed);
                logger.log('res:', res[1]);
                // await fs.writeFile(path.join(dest, 'markdown', `${course.title}.md`), md, 'utf8')//-${Date.now()}
                // fs.writeFileSync(`./json/test.txt`, res, 'utf8')
                throw err;
            }

        }
        logger.warn(`NO VIDEO link found for: ${ url }, skipping to yt-dlp...`);
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
                        logger.log('DONE for:', course.title);
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
                logger.log('DONE for:', course.title);
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
            logger.info(`${ prefix } - Starting writing to a file ...`)
            //await fs.writeFile(`./json/${filename}`, JSON.stringify(courses, null, 2), 'utf8');
            courses = orderBy(courses, [c => Number(c.downPath.split('-')[0]), 'position'], ['asc', 'asc']);
            courses = uniqBy(courses, 'url');
            await fs.ensureDir(path.resolve(__dirname, '../json'))
            await fs.writeFile(path.resolve(__dirname, `../json/${ filename }`), JSON.stringify(courses, null, 2), 'utf8')
            logger.info(`${ prefix } - Ended writing to a file ...`)
            // return Promise.resolve()
        }
        // logger.info(`${prefix} - file is used`)
        logger.info(`Downloaded all videos for '${ prefix }' api! (total: ${ courses.length })`)
        // return Promise.resolve()
        return courses;
    }
}

