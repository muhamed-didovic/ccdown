// @ts-check
const fileSize = require('./fileSize')
const { formatBytes, writeWaitingInfoDL } = require('./writeWaitingInfo');
const { createLogger, isCompletelyDownloaded } = require('./fileChecker');
const path = require('path')
const ytdl = require('ytdl-run')
const fs = require('fs-extra')
const Promise = require('bluebird')
const youtubedl = require("youtube-dl-wrap")

const pRetry = require('@byungi/p-retry').pRetry
const pDelay = require('@byungi/p-delay').pDelay

const getFilesizeInBytes = filename => {
    return fs.existsSync(filename) ? fs.statSync(filename)["size"] : 0;
};

const download = (url, dest, {
    localSizeInBytes,
    remoteSizeInBytes,
    downFolder,
    index = 0,
    ms
}) => new Promise(async (resolve, reject) => {
    const videoLogger = createLogger(downFolder);
    await fs.remove(dest) // not supports overwrite..
    ms.update(dest, {
        text : `to be processed by youtube-dl... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}`,
        color: 'blue'
    });
    // console.log(`to be processed by youtube-dl... ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}`)

    const youtubeDlWrap = new youtubedl()
    let youtubeDlEventEmitter = youtubeDlWrap
        .exec([url, "-o", path.toNamespacedPath(dest),])
        .on("progress", (progress) => {
            ms.update(dest, { text: `${index}. Downloading: ${progress.percent}% of ${progress.totalSize} at ${progress.currentSpeed} in ${progress.eta} | ${dest.split('/').pop()} Found:${localSizeInBytes}/${remoteSizeInBytes}` })
        })
        // .on("youtubeDlEvent", (eventType, eventData) => console.log(eventType, eventData))
        .on("error", (error) => {
            ms.remove(dest, { text: error })
            console.log('error--', error)
            //ms.remove(dest);
            fs.unlink(dest, (err) => {
                reject(error);
            });

        })
        .on("close", () => {
            //ms.succeed(dest, { text: `${index}. End download ytdl: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}` })//.split('/').pop()
            ms.remove(dest);
            console.log(`${index}. End download ytdl: ${dest} Found:${localSizeInBytes}/${remoteSizeInBytes} - Size:${formatBytes(getFilesizeInBytes(dest))}`);
            videoLogger.write(`${dest} Size:${getFilesizeInBytes(dest)}\n`);
            resolve()
        })

});

const downloadVideo = async (url, dest, {
    localSizeInBytes,
    remoteSizeInBytes,
    downFolder,
    index = 0,
    ms
}) => {
    try {
        await pRetry(
            () => download(url, dest,
                {
                    localSizeInBytes,
                    remoteSizeInBytes,
                    downFolder,
                    index,
                    ms
                }),
            {
                retries        : 3,
                onFailedAttempt: error => {
                    console.log(`Attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left.`);
                    // 1st request => Attempt 1 failed. There are 4 retries left.
                    // 2nd request => Attempt 2 failed. There are 3 retries left.
                    // …
                }
            })
    } catch (e) {
        console.log('eeee', e);
        ms.remove(dest, { text: `Issue with downloading` });
        //reject(e)
    }
}


/**
 * @param file
 * @param {import("fs").PathLike} dest
 * @param downFolder
 * @param index
 * @param ms
 */
module.exports = async (file, dest, { downFolder, index, ms } = {}) => {
    //const dest = path.join(downloadFolder, course.title)
    // console.log('url', url);
    const url = file.url;
    let remoteFileSize = file.size;
    ms.add(dest, { text: `Checking if video is downloaded: ${dest.split('/').pop()}` });
    // console.log(`Checking if video is downloaded: ${dest.split('/').pop()}`);
    /*try {
        let info = await ytdl.getInfo(url)
        console.log('info',info);
        let urlForSize = await Promise
            .map(info.formats.filter(f => f.format_note === 'DASH video'), async v => {
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
            })

        const options = {
            //'method': 'HEAD',
            //'url': info['requested_formats'][0]['url']
            url: urlForSize
        };

        remoteFileSize = await fileSize(options)
        //console.log(`YT Video size is ${remoteFileSize} or ${formatBytes(remoteFileSize)}`);
        ms.update(dest, { text: `YT Video size is ${remoteFileSize} or ${formatBytes(remoteFileSize)}` });
    } catch (e) {
        console.error('Errror with ytdl download:', e);
        //ms.fail(dest, { text: `Errror: ${dest}...` });
        ms.remove(dest)
        // console.error(`Errror: ${dest}...`, e)
        throw new Error(e)
        // return
    }*/

    //check if mpd is returned instead of mp4, so we need to check if we have video in videos.txt
    let isDownloaded = false;
    let localSize = getFilesizeInBytes(`${dest}`)
    let localSizeInBytes = formatBytes(getFilesizeInBytes(`${dest}`))
    //console.log(`Checking ${formatBytes(remoteFileSize)}/${formatBytes(remoteFileSize)} isCompletelyDownloaded: ${isDownloaded} for ${dest}`);
    //if (remoteFileSize < 2000) {
    //videos/AngularJS/lessons/005-angularjs-defining-a-method-on-the-scope.mp4 Size:12841002
    isDownloaded = isCompletelyDownloaded(downFolder, dest)
    // console.log(`Checking ${localSizeInBytes}/${formatBytes(remoteFileSize)} isCompletelyDownloaded: ${isDownloaded} for ${dest}`);
    ms.update(dest, { text: `Checking size over file: ${formatBytes(remoteFileSize)} isCompletelyDownloaded: ${isDownloaded} for ${dest}` });
    //}

    // fs.writeFileSync(`${dest}.json`, JSON.stringify(info, null, 2), 'utf8');
    // console.log(`-----`, remoteFileSize,  localSize, isDownloaded);
    if (remoteFileSize === localSize || isDownloaded) {
        ms.succeed(dest, { text: `${index}. Video already downloaded: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)}` });
        // console.log(`${index}. Video already downloaded: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)}`);
        //ms.remove(dest);
        // console.log(`${index}. Video already downloaded: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)}`.blue);
        // downloadBars.create(100, 100, { eta: 0, filename: dest })
        return;
    } else {
        ms.update(dest, { text: `${index} Start download video: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)} ` });
        // console.log(`${index} Start ytdl download: ${dest.split('/').pop()} - ${localSizeInBytes}/${formatBytes(remoteFileSize)} `);
        return await downloadVideo(url, dest, {
            localSizeInBytes,
            remoteSizeInBytes: formatBytes(remoteFileSize),
            downFolder,
            index,
            ms
        });
    }
}

