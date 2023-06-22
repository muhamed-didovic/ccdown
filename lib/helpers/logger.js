// const debug = require("debug");
import debug from "debug";

const appName = 'scraper';
const logLevels = ['error', 'warn', 'info', 'debug', 'log'];

export const logger = {};
// const logger = {};
logLevels.forEach(logLevel => {
    logger[logLevel] = debug(`${appName}:${logLevel}`);
});

export default logger;
// module.exports = logger

