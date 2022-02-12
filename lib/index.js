// const getAllBookIds = require('./getAllBookIds')
const path = require('path')
const fs = require('fs-extra')
const createLogger = require('./helpers/createLogger')
const Crawler = require('./Crawler')
const downFile = require('./helpers/downFile')
const Promise = require('bluebird')
const fileSize = require('./helpers/fileSize')
const { formatBytes } = require('./helpers/writeWaitingInfo')

exports.all = async (opts = {}) => {
  opts = normalizeOpts(opts)
  const { logger, concurrency } = opts
  // console.log('opts', opts);

  // login
  let crawler = new Crawler()
  crawler = await logger.promise(crawler.login(opts), 'Login...')

  // download from '/library/all' API
  const courses = await logger.promise(crawler.getAllCourses(opts), 'Finding all courses from /subjects endpoint..')

  // write into file courses
  fs.writeFileSync(`courses-${new Date().toISOString()}.json`, JSON.stringify(courses, null, 2), 'utf8')

  let cnt = 0
  logger.info(`Starting download with concurrency: ${concurrency} ...`)
  await Promise.map(courses, async (course) => {
    const dest = path.join(opts.dir, course.downPath)
    fs.ensureDir(path.join(opts.dir, course.downPath))

    const url = await crawler._vimeoRequest(course.url)
    await downFile(url, path.join(dest, course.title), { logger, concurrency })
    cnt++
  }, {
    concurrency// : 1
  })

  logger.succeed(`Downloaded all videos from /subjects api! (total: ${cnt})`)
}

exports.one = async (url, opts = {}) => {
  if (!url) throw new TypeError('`url` is required.')
  if (typeof url !== 'string') throw new TypeError(`Expected "url" to be of type "string", but "${typeof url}".`)

  opts = normalizeOpts(opts)
  const { logger, concurrency } = opts

  // login
  let crawler = new Crawler()
  crawler = await logger.promise(crawler.login(opts), 'Login...')

  // get single course
  const singleCourse = await logger.promise(crawler.getSingleCourse(url), 'Finding course videos..')

  // write course into file
  fs.writeFileSync('course.json', JSON.stringify(singleCourse, null, 2), 'utf8')

  let cnt = 0
  logger.info(`Starting download course with concurrency: ${concurrency} ...`)
  await Promise.map(singleCourse, async (course) => {
    const dest = path.join(opts.dir, course.downPath)
    fs.ensureDir(path.join(opts.dir, course.downPath))
    const url = await crawler._vimeoRequest(course.url)
    await downFile(url, path.join(dest, course.title), { logger, concurrency })
    cnt++
  }, {
    concurrency// : 1
  })
  logger.succeed(`DONE - downloaded video: ${cnt}`)
}

function normalizeOpts (opts) {
  if (!opts.dir) opts.dir = process.cwd()
  if (!opts.logger) opts.logger = require('./helpers/nullLogger')
  if (!opts.logger.isLogger) opts.logger = createLogger(opts.logger)
  if (!opts.concurrency) opts.concurrency = 10
  return opts
}
