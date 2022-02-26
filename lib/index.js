// const getAllBookIds = require('./getAllBookIds')
const path = require('path')
const fs = require('fs-extra')
const createLogger = require('./helpers/createLogger')
const Crawler = require('./Crawler')
const Promise = require('bluebird')
const fileSize = require('./helpers/fileSize')
const { formatBytes } = require('./helpers/writeWaitingInfo')
const { orderBy, uniqBy } = require("lodash")
const Spinnies = require('dreidels')
const ms = new Spinnies()

const downFile = require('./helpers/downFile')
const downOverYoutubeDL = require('./helpers/downOverYoutubeDL')

exports.all = async (opts = {}) => {
    opts = normalizeOpts(opts)
    const { logger, concurrency, file, filePath } = opts
    // console.log('opts', opts);

    // login
    let crawler = new Crawler()
    crawler = await logger.promise(crawler.login(opts), 'Login...')

    // download from '/library/all' API
    let courses = file ? require(filePath) : await logger.promise(crawler.getAllCourses(opts), 'Finding all courses from /subjects endpoint..')
    // const courses = file ? require(filePath) : await this.getList(opts);// await logger.promise(this.getList(opts), "Finding all courses from 'browse' endpoint api or platforms..")

    // write into file courses
    if (!file) {
        courses = orderBy( courses, [o => new Number(o.downPath.split('-')[0]), 'position'], ['asc', 'asc'] );
        courses = uniqBy(courses, 'url');
        fs.writeFileSync(`./json/courses-${new Date().toISOString()}.json`, JSON.stringify(courses, null, 2), 'utf8')
        //fs.writeFileSync(`courses.json`, JSON.stringify(sortedObjs, null, 2), 'utf8')
    }

    let cnt = 0
    logger.info(`Starting download with concurrency: ${concurrency} ...`)
    await Promise.map(courses, async (course, index) => {
        const dest = path.join(opts.dir, course.downPath)
        fs.ensureDir(dest)
        if (course.done) {
            console.log('DONE for:', course.title);
            cnt++
            return;
        }
        // console.log('CORSE for:', course.title);
        //const url = await crawler._vimeoRequest(course.url)
        //await downFile(url, path.join(dest, course.title), { downFolder: dest, ms, index })

        const details = await crawler._vimeoRequest(course)
        //await downFile(file, path.join(dest, course.title), { downFolder: dest, ms, index })
        await downOverYoutubeDL(details, path.join(dest, course.title), {
            downFolder: dest,
            index,
            ms
        })

        courses[index].done = true;
        if (file) {
            fs.writeFileSync(filePath, JSON.stringify(courses, null, 2), 'utf8');
            //fs.writeFileSync('./jsons/platforms-node.json', JSON.stringify(courses, null, 2), 'utf8');
        }
        cnt++
    }, {
        concurrency// : 1
    })
    ms.stopAll();
    logger.succeed(`Downloaded all videos from /subjects api! (total: ${cnt})`)
}

exports.one = async (url, opts = {}) => {
    if (!url) throw new TypeError('`url` is required.')
    if (typeof url !== 'string') throw new TypeError(`Expected "url" to be of type "string", but "${typeof url}".`)
    console.log('URL', url);
    opts = normalizeOpts(opts)
    const { logger, concurrency } = opts

    // login
    let crawler = new Crawler()
    crawler = await logger.promise(crawler.login(opts), 'Login...')

    // get single course
    const singleCourse = await logger.promise(crawler.getSingleCourse(url), 'Finding course videos..')
    // console.log('singleCourse', singleCourse);
    // write course into file
    fs.writeFileSync(`single-course-${new Date().toISOString()}.json`, JSON.stringify(singleCourse, null, 2), 'utf8')

    let cnt = 0
    logger.info(`Starting download course with concurrency: ${concurrency} ...`)
    await Promise.map(singleCourse, async (course, index) => {
        const dest = path.join(opts.dir, course.downPath)
        fs.ensureDir(dest)
        const details = await crawler._vimeoRequest(course)
        //await downFile(details, path.join(dest, course.title), { downFolder: dest, ms, index })
        await downOverYoutubeDL(details, path.join(dest, course.title), {
            downFolder: dest,
            index,
            ms
        })
        cnt++
    }, {
        concurrency//: 1
    })
    ms.stopAll();
    logger.succeed(`DONE - downloaded video: ${cnt}`)
}

function normalizeOpts(opts) {
    if (!opts.dir) opts.dir = process.cwd()
    if (!opts.logger) opts.logger = require('./helpers/nullLogger')
    if (!opts.logger.isLogger) opts.logger = createLogger(opts.logger)
    if (!opts.concurrency) opts.concurrency = 10
    return opts
}
