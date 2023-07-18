const YTDlpWrap = require('yt-dlp-wrap').default;
const ytDlpWrap = new YTDlpWrap();
// const Promise = require("bluebird");
const path = require("path");
const logger = require("./logger.cjs");
const FileChecker = require("./fileChecker.cjs");

const download = async ({ url, dest, downFolder }) => {
    try  {
        // const youtubeDlWrap = new YoutubeDlWrap()
        await ytDlpWrap.execPromise([
            url,
            "-o", path.resolve(dest),
            '--cookies-from-browser', 'chrome',
            '--socket-timeout', '5',
        ]);
        FileChecker.writeWithOutSize(downFolder, url)
        logger.info('Resource saved to:', path.resolve(dest))
    } catch (e) {
        // logger.warn('Error downloading source code', e);
        logger.error('Error downloading source code', e);
    }
};

const downloadCode = async ({ url, dest, downFolder }) => {
    return await download({
        url,//.vtt
        dest,
        downFolder
    });

}

module.exports = downloadCode
