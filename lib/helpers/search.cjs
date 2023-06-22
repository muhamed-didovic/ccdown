const path = require("path");
// import { fileURLToPath } from "url";
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

const series = require(path.join(__dirname, 'json/search-courses.json'));
// const downloaded = require(path.resolve(process.cwd(), 'json/downloaded-courses.json'));
// logger.log('111', path.resolve(process.cwd(), 'json/search-courses.json'));
module.exports = {
    series,
    // downloaded
};
