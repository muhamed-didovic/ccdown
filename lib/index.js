const createLogger = require('./helpers/createLogger')
const Crawler = require('./Crawler')

const Bluebird = require('bluebird')
Bluebird.config({ longStackTraces: true })
global.Promise = Bluebird;

const Spinnies = require('dreidels')
const ms = new Spinnies()

exports.all = async (opts = {}) => {
    opts = normalizeOpts(opts)
    const { logger, file, filePath } = opts

    // login
    let crawler = new Crawler()
    crawler = await logger.promise(crawler.login(opts), 'Login...')

    // download from '/library/all' API
    let courses = file ? require(filePath) : await crawler.getAllCourses({ ...opts, ms })
    const prefix = 'courses'
    const filename = `${prefix}-${new Date().toISOString()}.json`
    // await crawler.d(filename, prefix, res, opts);
    await crawler.writeVideosIntoFile(file, logger, prefix, courses, filename)
}

exports.one = async (url, opts = {}) => {
    if (!url) throw new TypeError('`url` is required.')
    if (typeof url !== 'string') throw new TypeError(`Expected "url" to be of type "string", but "${typeof url}".`)
    //get code and resources as well from 'watch' endpoint
    url = url.replace('/courses/', '/watch/')

    opts = normalizeOpts(opts)
    console.log('single opts', opts, {url});
    const { logger, file, filePath } = opts

    // login
    let crawler = new Crawler()
    crawler = await logger.promise(crawler.login(opts), 'Login...')

    // get single course
    const courses = file ? require(filePath) : await crawler.getSingleCourse({ url, ms, ...opts })
    const prefix = 'single-course'
    const filename = `${prefix}-${new Date().toISOString()}.json`
    // await crawler.d(filename, prefix, courses, {ms, ...opts});
    await crawler.writeVideosIntoFile(file, logger, prefix, courses, filename)

}

function normalizeOpts(opts) {
    if (!opts.dir) opts.dir = process.cwd()
    if (!opts.logger) opts.logger = require('./helpers/nullLogger')
    if (!opts.logger.isLogger) opts.logger = createLogger(opts.logger)
    if (!opts.concurrency) opts.concurrency = 10
    return opts
}
