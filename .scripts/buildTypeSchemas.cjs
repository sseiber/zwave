const childProcess = require('child_process');
const os = require('os');
const fse = require('fs-extra');
const path = require('path');
const { Command } = require('commander');

const programArgs = new Command()
    .option('-t, --types-file <typesFile>', 'The TypeScript types file to process')
    .option('-o, --output-dir <outputDir>', 'The output directory for the generated schemas')
    .parse(process.argv);
const programOptions = programArgs.opts();

function log(message) {
    console.log(message);
}

async function start() {
    let buildSucceeded = true;

    try {
        log(`Schema builder`);
        log(`Platform: ${os.type()}`);

        const typesTsFile = path.resolve(__dirname, programOptions.typesFile);
        if (!fse.existsSync(typesTsFile)) {
            throw new Error(`typesTsFile ${typesTsFile} not found`);
        }

        const outputDirectory = path.resolve(__dirname, programOptions.outputDir ?? '../src/models/schemas');
        if (!fse.existsSync(outputDirectory)) {
            throw new Error(`outputDirectory ${outputDirectory} not found`);
        }

        const typesTsFileSource = fse.readFileSync(typesTsFile, { encoding: 'utf-8' });
        const interfaceNames = [...typesTsFileSource.matchAll(/export interface (\S*)/g)].map((match) => match[1]);

        for (const interfaceName of interfaceNames) {
            log(`Building schema for type: ${interfaceName}`);

            const buildArgs = [
                '--tsconfig',
                './tsconfig.json',
                '--path',
                typesTsFile,
                '--type',
                interfaceName,
                '--id',
                interfaceName,
                '--out',
                path.resolve(outputDirectory, `${interfaceName}Schema.json`)
            ];

            childProcess.execFileSync('./node_modules/.bin/ts-json-schema-generator', buildArgs, { stdio: [0, 1, 2] });
        }

        log(`Type builder complete`);
    }
    catch (ex) {
        buildSucceeded = false;

        log(`Error: ${ex.message}`);
    }

    if (!buildSucceeded) {
        log(`Type builder failed, exiting...`);

        process.exit(-1);
    }
}

void (async () => {
    await start();
})().catch();
