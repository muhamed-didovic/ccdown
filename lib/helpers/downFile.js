// @ts-check
const fs = require('fs')
const fileSize = require('./fileSize')
const progress = require('request-progress')
// const request = require('request')
const request = require('requestretry').defaults({ retryDelay: 500 })
const { writeWaitingInfo, formatBytes, secondsToHms } = require('./writeWaitingInfo')

const getFilesizeInBytes = filename => {
    // console.log('stats', stats);
    return fs.existsSync(filename) ? fs.statSync(filename).size : 0
}
const downloadVideo = (url, dest, ms, {
    localSizeInBytes,
    remoteSizeInBytes,
    index
}) => new Promise(function (resolve, reject) {
    const name = url + index;
    const req = request({
        url,//: 'https://api.domain.com/v1/a/b',
        json: true,

        // The below parameters are specific to request-retry
        maxAttempts  : 5,   // (default) try 5 times
        retryDelay   : 5000,  // (default) wait for 5s before trying again
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError // (default) retry on 5xx or network errors
    })

    progress(req, { throttle: 2000, delay: 1000 })
        .on('progress', state => {
            //writeWaitingInfo(state, dest, ms, name, { localSizeInBytes, remoteSizeInBytes })
            const percent = (state.percent * 100).toFixed(2)
            const transferred = formatBytes(state.size.transferred)
            const total = formatBytes(state.size.total)
            const remaining = secondsToHms(state.time.remaining)
            const speed = formatBytes(state.speed)
            const t = `Downloading: ${percent}% | ${transferred} / ${total} | ${speed}/sec | ${remaining} - ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes}`
            ms.update(name, { text: t, color: 'blue' })
        })
        .on('end', () => {
            ms.succeed(name, { text: `End download video ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes}` })
            //console.log(`End download video ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes}`);
            resolve()
        })
        .on('error', err => {
            if (err.code === "ECONNRESET") {
                console.error(`Timeout occurs. Details ${err.message}`);
            }
            //ms.fail(name, { text: err })
            ms.remove(name);
            console.log('ERR code:::', err.code);
            console.log('ERRRRRRR:', err);
            reject(err)
        })
        .pipe(fs.createWriteStream(dest))
})

/**
 * @param {string} url
 * @param {import("fs").PathLike} dest
 * @param logger
 * @param concurrency
 */
module.exports = async (url, dest, { logger, concurrency, ms, index } = {}) => {
    // const random = (Math.random() + 1).toString(36).substring(7)
    // url = encodeURI(url)
    // console.log('URL to downlad', url);
    const name = url + index
    ms.add(name, { text: `Checking if video is downloaded: ${dest}` })
    // console.log(`Checking if video is downloaded: ${dest}`);
    let remoteFileSize
    try {
        const options = {
            method : 'GET',
            url    : url,
            headers: {
                Referer: 'https://codecourse.com/'
            }
        }
        remoteFileSize = await fileSize(options)
        ms.update(name, { text: `Video size is ${remoteFileSize} or ${formatBytes(remoteFileSize)}` })
        //console.log(`Video size is ${remoteFileSize} or ${formatBytes(remoteFileSize)}`);
    } catch (e) {
        console.log('eeee', e);
        ms.remove(dest)
        // ms.fail(name, { text: `Cant download video: ${url}` })
        throw new Error(e)
    }
    const localSize = getFilesizeInBytes(`${dest}`)
    const localSizeInBytes = formatBytes(getFilesizeInBytes(`${dest}`))
    if (remoteFileSize === localSize) {
        ms.remove(dest);
        // ms.succeed(name, { text: `Video already downloaded: ${dest}` })
        //console.log(`Video already downloaded: ${dest}`);
        return;
    } else {
        //console.log(`${localSizeInBytes}/${formatBytes(remoteFileSize)} - Start download video: ${dest}`);
        ms.update(name, { text: `${localSizeInBytes}/${formatBytes(remoteFileSize)} - Start download video: ${dest}` })

        return await downloadVideo(url, dest, ms, {
            localSizeInBytes,
            remoteSizeInBytes: formatBytes(remoteFileSize),
            index
        })
    }
}
