[![npm](https://badgen.net/npm/v/ccdown)](https://www.npmjs.com/package/ccdown)
[![Downloads](https://img.shields.io/npm/dm/ccdown.svg?style=flat)](https://www.npmjs.org/package/ccdown)
[![Hits](https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fgithub.com%2Fmuhamed-didovic%2Fccdown&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=hits&edge_flat=false)](https://hits.seeyoufarm.com)
[![license](https://flat.badgen.net/github/license/muhamed-didovic/ccdown)](https://github.com/muhamed-didovic/ccdown/blob/main/LICENSE)

# Downloader and scraper for codecourse.com for pro members

## Requirement
- Node 18
- yt-dlp (https://github.com/yt-dlp/yt-dlp)

## Install
```sh
npm i -g ccdown
```

#### without Install
```sh
npx ccdown
```

## CLI
```sh
Usage
    $ ccdown [CourseUrl]

Options
    --all, -a           Get all courses.
    --email, -e         Your email.
    --password, -p      Your password.
    --directory, -d     Directory to save.
    --file, -f          Location of the file where are the courses
    --videos, -v        Download videos (values: 'yes' or 'no'), default value is 'yes'
    --concurrency, -c

Examples
    $ ccdown
    $ ccdown -a
    $ ccdown [url] [-e user@gmail.com] [-p password] [-d dirname] [-c number] [-f path-to-file] [-v yes or no]
```

## Log and debug
This module uses [debug](https://github.com/visionmedia/debug) to log events. To enable logs you should use environment variable `DEBUG`.
Next command will log everything from `scraper`
```bash
export DEBUG=scraper*; vsdown
```

Module has different loggers for levels: `scraper:error`, `scraper:warn`, `scraper:info`, `scraper:debug`, `scraper:log`. Please read [debug](https://github.com/visionmedia/debug) documentation to find how to include/exclude specific loggers.

## License
MIT
