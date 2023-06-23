import createLogger from "./helpers/createLogger.js";
import Crawler from "./Crawler.js";
import logger from "./helpers/logger.js";
// import Spinnies from "dreidels";
// const ms = new Spinnies()

import Spinnies from 'dreidels'
const ms = new Spinnies.default()

// const Bluebird = require('bluebird')
// Bluebird.config({ longStackTraces: true })
// global.Promise = Bluebird;

export const all = async (opts = {}) => {
    opts = normalizeOpts(opts)
    const { oraLogger, file, filePath } = opts

    // login
    let crawler = new Crawler()
    crawler = await oraLogger.promise(crawler.login(opts), 'Login...')

    // download from '/library/all' API
    let courses = file ? require(filePath) : await crawler.getAllCourses({ ...opts, ms })
    const prefix = 'courses'
    const filename = `${prefix}-${new Date().toISOString()}.json`
    // await crawler.d(filename, prefix, res, opts);
    await crawler.writeVideosIntoFile(file, logger, prefix, courses, filename)
}

export const one = async (url, opts = {}) => {
    if (!url) throw new TypeError('`url` is required.')
    if (typeof url !== 'string') throw new TypeError(`Expected "url" to be of type "string", but "${typeof url}".`)
    //get code and resources as well from 'watch' endpoint
    url = url.replace('/courses/', '/watch/')

    opts = normalizeOpts(opts)
    logger.log('single opts', opts, {url});
    const { oraLogger, file, filePath } = opts

    // login
    let crawler = new Crawler()
    crawler = await oraLogger.promise(crawler.login(opts), 'Login...')

    // get single course
    const courses = file ? require(filePath) : await crawler.getSingleCourse({ url, ms, ...opts })
    const prefix = 'single-course'
    const filename = `${prefix}-${new Date().toISOString()}.json`
    // await crawler.d(filename, prefix, courses, {ms, ...opts});
    await crawler.writeVideosIntoFile(file, logger, prefix, courses, filename)

}

function normalizeOpts(opts) {
    if (!opts.dir) opts.dir = process.cwd()
    // if (!opts.oraLogger) opts.oraLogger = require('./helpers/nullLogger')
    // if (!opts.oraLogger.isLogger) opts.oraLogger = createLogger(opts.oraLogger)
    if (!opts.concurrency) opts.concurrency = 10
    return opts
}
