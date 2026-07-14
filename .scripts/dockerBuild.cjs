const childProcess = require('child_process');
const os = require('os');
const path = require('path');
const fse = require('fs-extra');
const { Command } = require('commander');

const programArgs = new Command()
    .option('-c, --config-file <configFile>', 'Build config file')
    .option('-b, --docker-build', 'Docker build the image')
    .option('-d, --debug', 'Use debug build options')
    .option('-p, --docker-push', 'Docker push the image')
    .option('-w, --workspace-folder-path <workspaceFolderPath>', 'Workspace folder path')
    .option('-v, --image-version <version>', 'Docker image version override')
    .parse(process.argv);
const programOptions = programArgs.opts();

function log(message) {
    console.log(message);
}

async function execDockerBuild(workspaceName, dockerfile, dockerArch, dockerImage) {
    // A multi-platform build (comma-separated platforms) cannot be loaded into the
    // local image store; it must be pushed directly to the registry, and requires a
    // container-driver buildx builder (see README). A single-platform build is
    // loaded locally so it can be run/tested and pushed separately.
    const isMultiPlatform = dockerArch.includes(',');

    const dockerArgs = [
        'buildx',
        'build',
        '--build-arg',
        `WORKSPACE_NAME=${workspaceName}`,
        '-f',
        `docker/${dockerfile}`,
        '--platform',
        dockerArch,
        isMultiPlatform ? '--push' : '--load',
        '-t',
        dockerImage,
        '.'
    ];

    childProcess.execFileSync('docker', dockerArgs, { stdio: [0, 1, 2] });
}

async function execDockerPush(dockerImage) {
    const dockerArgs = [
        'push',
        dockerImage
    ];

    childProcess.execFileSync('docker', dockerArgs, { stdio: [0, 1, 2] });
}

async function start() {
    let buildSucceeded = true;

    try {
        const workspaceFolderPath = programOptions.workspaceFolderPath ?? path.dirname(process.env.npm_package_json);
        if (!workspaceFolderPath) {
            throw new Error('Unable to determine the appropriate workspaceFolderPath for this operation, please specify the workspace folder path using the -w option');
        }

        const configFile = programOptions.configFile ?? `imageConfig.json`;
        const imageConfigFilePath = path.resolve(workspaceFolderPath, `configs`, configFile);
        const imageConfig = fse.readJSONSync(imageConfigFilePath);
        const dockerfile = imageConfig.dockerfile ?? `Dockerfile`;
        const dockerVersion = imageConfig.versionTag ?? process.env.npm_package_version ?? programOptions.imageVersion ?? 'latest';
        const dockerArch = `${imageConfig.arch}` ?? 'linux/amd64';
        const dockerImage = `${imageConfig.imageName}:${dockerVersion}`;

        log(`Docker image: ${dockerImage}`);
        log(`Platform: ${os.type()}`);

        if (programOptions.dockerBuild) {
            await execDockerBuild(path.basename(workspaceFolderPath), dockerfile, dockerArch, dockerImage);
        }

        // A multi-platform build is pushed during the build step, so a separate push is
        // neither needed nor possible (the image is not in the local store).
        if (programOptions.dockerPush && !dockerArch.includes(',')) {
            await execDockerPush(dockerImage);
        }

        log(`Docker operation complete`);
    }
    catch (ex) {
        buildSucceeded = false;

        log(`Error: ${ex.message}`);
    }

    if (!buildSucceeded) {
        log(`Docker operation failed, exiting...`);

        process.exit(-1);
    }
}

void (async () => {
    await start();
})().catch();
