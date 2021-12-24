// @ts-check
const fs = require('fs')
const fileSize = require('./fileSize')
const progress = require('request-progress');
const request = require('request');
const { writeWaitingInfo, formatBytes } = require('./writeWaitingInfo');
const Spinnies = require('spinnies')
const ms = new Spinnies();

const getFilesizeInBytes = filename => {
    // console.log('stats', stats);
    return fs.existsSync(filename) ? fs.statSync(filename)["size"] : 0;
};
const downloadVideo = (url, dest, ms, {localSizeInBytes, remoteSizeInBytes}) => new Promise(function (resolve, reject) {

    let req = request(url);
    progress(req, { throttle: 2000, delay: 1000 })
        .on('progress', state => {
            writeWaitingInfo(state, dest, ms, url, {localSizeInBytes, remoteSizeInBytes})
        })
        .on('end', () => {
            ms.succeed(url, { text: `End download video ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes}` });
            resolve()
        })
        .on('error', err => {
            ms.fail(url, { text: err });
            reject(err);
        })
        .pipe(fs.createWriteStream(dest));
});

/**
 * @param {string} url
 * @param {import("fs").PathLike} dest
 * @param logger
 * @param concurrency
 */
module.exports = async (url, dest, { logger, concurrency } = {}) => {
    // const random = (Math.random() + 1).toString(36).substring(7)
    //url = encodeURI(url)
    // console.log('URL to downlad', url);
    ms.add(url, { text: `Checking if video is downloaded: ${dest}` });
    let remoteFileSize;
    try {

        const options = {
            'method': 'GET',
            'url': url,
            'headers': {
                'Referer': 'https://codecourse.com/'
            }
        };
        remoteFileSize = await fileSize(options)
        ms.update(url, { text: `Video size is ${remoteFileSize} or ${formatBytes(remoteFileSize)}` });
    } catch (e) {
        //console.log('eeee', e);
        ms.fail(url, { text: `Cant download video: ${url}` });
        return;
    }
    let localSize = getFilesizeInBytes(`${dest}`)
    let localSizeInBytes = formatBytes(getFilesizeInBytes(`${dest}`))
    if (remoteFileSize === localSize) {
        ms.succeed(url, { text: `Video already downloaded: ${dest}` });
        return;
    } else {
        //console.log(`${localSizeInBytes}/${formatBytes(remoteFileSize)} - Start download video: ${dest}`);
        ms.update(url, { text: `${localSizeInBytes}/${formatBytes(remoteFileSize)} - Start download video: ${dest}` });
        return await downloadVideo(url, dest, ms, {localSizeInBytes, remoteSizeInBytes: formatBytes(remoteFileSize)});
    }

}
