#!/usr/bin/env node
const meow = require('meow')
const prompts = require('prompts')
const createLogger = require('./helpers/createLogger')
const { one, all } = require('.')
const path = require('path')
const fs = require('fs-extra')
const isValidPath = require('is-valid-path')
const Crawler = require("./Crawler")
const Fuse = require('fuse.js')

const cli = meow(`
Usage
    $ ccdown [CourseUrl]

Options
    --all, -a           Get all courses.
    --email, -e         Your email.
    --password, -p      Your password.
    --directory, -d     Directory to save.
    --file, -f          Location of the file where are the courses
    --concurrency, -c

Examples
    $ ccdown
    $ ccdown -a
    $ ccdown [url] [-e user@gmail.com] [-p password] [-d dirname] [-c number] [-f path-to-file]
`, {
    flags: {
        help       : { alias: 'h' },
        version    : { alias: 'v' },
        all        : { type: 'boolean', alias: 'a' },
        email      : { type: 'string', alias: 'e' },
        password   : { type: 'string', alias: 'p' },
        directory  : { type: 'string', alias: 'd' },
        concurrency: { type: 'number', alias: 'c', default: 10 },
        file       : { type: 'boolean', alias: 'f' }
    }
})

const logger = createLogger()
// const errorHandler = err => (console.log('\u001B[1K'), logger.fail(String(err)), process.exit(1))
// const errorHandler = err => (console.error(err), logger.fail(String(err)), process.exit(1))
const errorHandler = err => (console.error('MAIN errorr:', err), process.exit(1))//logger.fail(`HERE IS THE ERROR in string: ${String(err}`))

const askOrExit = question => prompts({ name: 'value', ...question }, { onCancel: () => process.exit(0) }).then(r => r.value);

const folderContents = async (folder) => {
    const files = await fs.readdir(folder)
    if (!files.length) {
        return console.log('No files found');
    }
    console.log(`found some files: ${files.length} in folder: ${folder}`);
    return files.map(file => ({
        title: file,
        value: path.join(folder, file)
    }));
}

async function commonFlags(flags) {
    const email = flags.email || await askOrExit({
        type    : 'text',
        message : 'Enter email',
        validate: value => value.length < 5 ? 'Sorry, enter correct email' : true
    })
    const password = flags.password || await askOrExit({
        type    : 'password',
        message : 'Enter password',
        validate: value => value.length < 5 ? `Sorry, password must be longer` : true
    })

    const dir = flags.directory
        ? path.resolve(flags.directory)
        : path.resolve(await askOrExit({
            type    : 'text',
            message : `Enter a directory to save a file (eg: ${path.resolve(process.cwd())})`,
            initial : './videos',
            validate: isValidPath
        }))
    // const dir = flags.directory || path.resolve(await askOrExit({
    //     type    : 'text',
    //     message : `Enter a directory to save (eg: ${path.resolve(process.cwd())})`,
    //     initial : path.resolve(process.cwd(), 'videos/'),
    //     validate: isValidPath
    // }))
    const concurrency = flags.concurrency || await askOrExit({
        type   : 'number',
        message: `Enter concurrency`,
        initial: 10
    })

    return {
        email,
        password,
        dir,
        concurrency
    };
}

(async () => {
    const { flags, input } = cli
    // console.log('cli', { flags, input });
    //const fileChoices = await folderContents(path.resolve(process.cwd(), 'json'))

    if (flags.all || (input.length === 0 && await askOrExit({
        type: 'confirm', message: 'Do you want all courses?', initial: false
    }))) {
        const file = flags.file || await askOrExit({
            type   : 'confirm',
            message: 'Do you want download from a file',
            initial: false
        })

        const filePath = flags.file || await askOrExit({
            type    : file ? 'autocomplete' : null,
            message : `Enter a file path eg: ${path.resolve(process.cwd(), 'json/*.json')} `,
            choices : await folderContents(path.resolve(process.cwd(), 'json')),
            validate: isValidPath
        })

        const options = await commonFlags(flags);
        all({ logger, file, filePath, ...options }).catch(errorHandler)
        return
    }

    if (input.length === 0) {
        const searchOrDownload = await askOrExit({
            type   : 'confirm',
            message: 'Choose "Y" if you want to search for a course otherwise choose "N" if you have a link for download',
            initial: true
        })

        //url is provided
        if (searchOrDownload === false) {
            input.push(await askOrExit({
                type    : 'text',
                message : 'Enter url for download.',
                initial : 'https://codecourse.com/courses/alpine-store-basics',
                validate: value => value.includes('codecourse.com') ? true : 'Url is not valid'
            }))
        } else { // url is not provided search for courses
            let searchCoursesFile = false;
            if (await fs.exists(path.resolve(process.cwd(), 'json/search-courses.json'))) {
                searchCoursesFile = true;
            }

            const foundSearchCoursesFile = await askOrExit({
                type   : (searchCoursesFile && input.length === 0 && !flags.file) ? 'confirm' : null,
                message: 'Do you want to search for a courses from a local file (which is faster)',
                initial: true
            })

            input.push(await askOrExit({
                type   : 'autocomplete',
                message: 'Search for a course',
                choices: await Crawler.getCourses(foundSearchCoursesFile),
                suggest: (input, choices) => {
                    if (!input) return choices;
                    const fuse = new Fuse(choices, {
                        keys: ['title', 'value']
                    })
                    return fuse.search(input).map(i => i.item);
                },
            }))
        }
    }

    const options = await commonFlags(flags);
    const courseUrl = input[0]
    one(courseUrl, { logger, ...options }).catch(errorHandler)
})()
