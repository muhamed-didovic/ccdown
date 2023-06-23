#!/usr/bin/env node
import meow from "meow";
import path from "path";
import fs from "fs-extra";
import prompts from "prompts";
import isValidPath from "is-valid-path";
// import isEmail from "util-is-email";
import Fuse from "fuse.js";

import Crawler from "./Crawler.js";
import { all, one } from "./index.js";
import logger from "./helpers/logger.js";
import createLogger from "./helpers/createLogger.js";

import Bluebird from "bluebird";
import { fileURLToPath } from "url";
Bluebird.config({ longStackTraces: true });
global.Promise = Bluebird;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    hardRejection: false,
    importMeta: import.meta,
    booleanDefault: undefined,
    flags: {
        help       : { shortFlag: 'h' },
        version    : { shortFlag: 'v' },
        all        : { type: 'boolean', shortFlag: 'a' },
        email      : { type: 'string', shortFlag: 'e' },
        password   : { type: 'string', shortFlag: 'p' },
        directory  : { type: 'string', shortFlag: 'd' },
        concurrency: { type: 'number', shortFlag: 'c', default: 10 },
        file       : { type: 'boolean', shortFlag: 'f' }
    }
})

const oraLogger = createLogger()
// const errorHandler = err => (console.log('\u001B[1K'), oraLogger.fail(String(err)), process.exit(1))
// const errorHandler = err => (console.error(err), oraLogger.fail(String(err)), process.exit(1))
const errorHandler = err => (console.error('MAIN errorr in cli.js:', err), process.exit(1))//oraLogger.fail(`HERE IS THE ERROR in string: ${String(err}`))

const askOrExit = question => prompts({ name: 'value', ...question }, { onCancel: () => process.exit(0) }).then(r => r.value);

const folderContents = async (folder) => {
    const files = await fs.readdir(folder)
    if (!files.length) {
        logger.warn('No files found for download by file')
        return;
    }
    logger.debug(`found some files: ${files.length} in folder: ${folder}`);
    return files.map(file => ({
        title: file,
        value: path.join(folder, file)
    }))
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
            initial : path.resolve(process.cwd(), 'videos/'),
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
            message : `Enter a file path eg: ${path.resolve(__dirname, '../json/*.json')} `,
            choices : await folderContents(path.resolve(__dirname, '../json')),
            validate: isValidPath
        })

        const options = await commonFlags(flags);
        all({ oraLogger, file, filePath, ...options }).catch(errorHandler)
        return
    }

    const searchOrDownload = await askOrExit({//flags.file ||
        type   : input.length === 0 ? 'confirm' : null,
        message: 'Choose "Y" if you want to search for a course otherwise choose "N" if you have a link for download',
        initial: true
    })

    if (input.length === 0 && searchOrDownload === false) {
        input.push(await askOrExit({
            type    : 'text',
            message : 'Enter url for download.',
            initial : 'https://codecourse.com/courses/alpine-store-basics',
            validate: value => value.includes('codecourse.com') ? true : 'Url is not valid'
        }))
    } else {
        // url is not provided search for courses
        let searchCoursesFile = false;
        if (await fs.exists(path.resolve(__dirname, '../json/search-courses.json'))) {
            searchCoursesFile = true;
        }

        const foundSearchCoursesFile = await askOrExit({
            type   : (searchCoursesFile && input.length === 0 && !flags.file) ? 'confirm' : null,
            message: 'Do you want to search for a courses from a local file (which is faster)',
            initial: true
        })

        /*input.push(await askOrExit({
            type   : input.length === 0 ? 'autocomplete' : null,
            message: 'Search for a course',
            choices: await Crawler.getCourses(foundSearchCoursesFile),
            suggest: (input, choices) => {
                if (!input) return choices;
                const fuse = new Fuse(choices, {
                    keys: ['title', 'value']
                })
                return fuse.search(input).map(i => i.item);
            },
        }))*/

        async function selectMultipleCourses() {

            const answers = await askOrExit({
                type   : 'autocompleteMultiselect',
                message: 'Search for a course',
                choices: await Crawler.getCourses(foundSearchCoursesFile),
                suggest: (input, choices) => {
                    if (!input) return choices;
                    const fuse = new Fuse(choices, {
                        keys: ['title', 'value']
                    })
                    return fuse.search(input).map(i => i.item);
                },
                hint: '- Space to select. Return to submit'
            })
            if (answers.length === 0) {
                return await selectMultipleCourses();
            }

            return answers;
            /*// prompt to ask for which images to bump
            const answers = await prompts({
                // type: 'multiselect',
                name: 'things',
                // message: 'Which things do you want to bump?',
                // choices,
                type   : 'autocompleteMultiselect',
                message: 'Search for a course',
                choices: await Crawler.getCourses(foundSearchCoursesFile),
                suggest: (input, choices) => {
                    if (!input) return choices;
                    const fuse = new Fuse(choices, {
                        keys: ['title', 'value']
                    })
                    return fuse.search(input).map(i => i.item);
                },
                hint: '- Space to select. Return to submit'
            });
            if (answers.things.length === 0) {
                return await sanitizeCourses(choices);
            }

            return answers.things;*/
        }

        if (input.length === 0) {
            input.push(await selectMultipleCourses())
        }
        // input.push(await askOrExit({
        //     type   : input.length === 0 ? 'autocompleteMultiselect' : null,
        //     message: 'Search for a course',
        //     choices: await Crawler.getCourses(foundSearchCoursesFile),
        //     suggest: (input, choices) => {
        //         if (!input) return choices;
        //         const fuse = new Fuse(choices, {
        //             keys: ['title', 'value']
        //         })
        //         return fuse.search(input).map(i => i.item);
        //     },
        //     hint: '- Space to select. Return to submit'
        // }))

    }
    // console.log('input', input.flat());
    const options = await commonFlags(flags);
    const urls = input.flat();//input[0]
    all({ oraLogger, urls, ...options }).catch(errorHandler)
})()
