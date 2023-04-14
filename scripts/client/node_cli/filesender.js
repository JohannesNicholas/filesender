#!/usr/bin/env node

/**
 * FileSender www.filesender.org
 *
 * Copyright (c) 2009-2019, AARNet, Belnet, HEAnet, SURFnet, UNINETT
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * *   Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * *   Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * *   Neither the name of AARNet, Belnet, HEAnet, SURFnet and UNINETT nor the
 *     names of its contributors may be used to endorse or promote products
 *     derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

const axios = require('axios');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const https = require('https');
const path = require('path');
const { ArgumentParser } = require('argparse');
const { exit } = require('process');
const async = require('async');


const { promisify } = require("util");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("workerpool"); // Assuming you have a proper worker pool module

let base_url = '[base_url]';
let default_transfer_days_valid = 10;
let username = null;
let apikey = null;
let debug = false;
let final_worker_retries = 0;
let final_worker_timeout = 0;
let final_worker_count = 0;
let upload_chunk_size = 0;
let worker_count = 0;
let worker_timeout = 0;
let worker_retries = 0;
let terasender_enabled = false;
let progress = false;

const homepath = os.homedir();

// Read and parse config
try {
    const configFile = path.join(homepath, '.filesender', 'filesender.py.ini');
    if (fs.existsSync(configFile)) {
        const configContent = fs.readFileSync(configFile, 'utf8');
        const lines = configContent.split('\n');
        const config = {};
        let currentSection = '';

        for (const line of lines) {
            if (line.trim().startsWith('[') && line.trim().endsWith(']')) {
                currentSection = line.trim().slice(1, -1);
                config[currentSection] = {};
            } else if (line.includes('=')) {
                const [key, value] = line.trim().split('=');
                config[currentSection][key.trim()] = value.trim();
            }
        }

        if (config['system']) {
            base_url = config['system']['base_url'] || base_url;
            default_transfer_days_valid = parseInt(config['system']['default_transfer_days_valid']) || default_transfer_days_valid;
        }

        if (config['user']) {
            username = config['user']['username'];
            apikey = config['user']['apikey'];
        }
    }
} catch (error) {
    console.error('Error reading config file:', error);
}

// Configure argument parser
const parser = new ArgumentParser({
    description: 'File Sender CLI client.\nSource code: https://github.com/filesender/filesender/blob/master/scripts/client/filesender.py',
    epilog: `A config file can be added to ${homepath}/.filesender/filesender.py.ini to avoid having to specify username and apikey on the command line.\n\nExample (Config file is present):\nnode filesender.js -r reciever@example.com file1.txt`,
});



parser.add_argument('files', { help: 'path to file(s) to send', nargs: '+' });
parser.add_argument('-v', '--verbose', { action: 'store_true' });
parser.add_argument('-i', '--insecure', { action: 'store_true' });
parser.add_argument('-p', '--progress', { action: 'store_true' });
parser.add_argument('-s', '--subject');
parser.add_argument('-m', '--message');
parser.add_argument('-g', '--guest', { action: 'store_true' });
parser.add_argument('--threads');
parser.add_argument('--timeout');
parser.add_argument('--retries');

const requiredNamed = parser.add_argument_group('required named arguments');

if (username === undefined) {
    requiredNamed.add_argument('-u', '--username', { required: true });
} else {
    parser.add_argument('-u', '--username');
}

if (apikey === undefined) {
    requiredNamed.add_argument('-a', '--apikey', { required: true });
} else {
    parser.add_argument('-a', '--apikey');
}

requiredNamed.add_argument('-r', '--recipients', { required: true });
const args = parser.parse_args();


// Set user-specific configs
if (args.username !== undefined) {
    username = args.username;
}

if (args.apikey !== undefined) {
    apikey = args.apikey;
}

if (args.verbose) {
    debug = true;
}

guest = args.guest
progress = args.progress
user_retries = args.retries
insecure = args.insecure
progress = args.progress


async function getConfigs() {
    try {
        const infoResponse = await axios.get(`${base_url}/info`, { httpsAgent: new https.Agent({ rejectUnauthorized: !args.insecure }) });
        const configResponse = await axios.get(`${base_url.slice(0, -9)}/filesender-config.js.php`, { httpsAgent: new https.Agent({ rejectUnauthorized: !args.insecure }) });

        upload_chunk_size = infoResponse.data['upload_chunk_size'];

        try {
            const regex_match = configResponse.data.match(/terasender_worker_count\D*(\d+)/);
            worker_count = parseInt(regex_match[1], 10);
            //const worker_timeout_match = re.exec(/terasender_worker_start_must_complete_within_ms\D*(\d+)/, configResponse.data);
            const worker_timeout_match = configResponse.data.match(/terasender_worker_start_must_complete_within_ms\D*(\d+)/);
            worker_timeout = Math.floor(parseInt(worker_timeout_match[1], 10) / 1000);
            //const worker_retries_match = re.exec(/terasender_worker_max_chunk_retries\D*(\d+)/, configResponse.data);
            const worker_retries_match = configResponse.data.match(/terasender_worker_max_chunk_retries\D*(\d+)/);
            worker_retries = parseInt(worker_retries_match[1], 10);
            //const terasender_enabled_match = re.exec(/terasender_enabled\W*(\w+)/, configResponse.data);
            const terasender_enabled_match = configResponse.data.match(/terasender_enabled\W*(\w+)/);
            terasender_enabled = terasender_enabled_match[1] === "true";

            final_worker_count = terasender_enabled ? worker_count : 1;
            if (args.threads) {
                final_worker_count = Math.min(parseInt(args.threads, 10), worker_count);
            }

            final_worker_timeout = worker_timeout;
            if (args.timeout) {
                final_worker_timeout = Math.min(parseInt(args.timeout, 10), worker_timeout);
            }

            final_worker_retries = worker_retries;
            if (args.retries) {
                final_worker_retries = Math.min(parseInt(args.retries, 10), worker_retries);
            }

            if (args.verbose) {
                console.log('base_url          : ' + base_url);
                console.log('username          : ' + username);
                console.log('apikey            : ' + apikey);
                console.log('upload_chunk_size : ' + upload_chunk_size + ' bytes');
                console.log('recipients        : ' + args.recipients);
                console.log('files             : ' + args.files.join(','));
                console.log('insecure          : ' + args.insecure);
            }

        } catch (error) {
            console.error("Failed to parse match", error);
            // Set default values
            worker_count = 4;
            worker_timeout = 180;
            max_chunk_retries = 20;
            terasender_enabled = false;
        }
    } catch (error) {
        if (!args.insecure && error.response && error.response.status === 500) {
            console.error('Error: the SSL certificate of the server you are connecting to cannot be verified:');
            console.error(error.message);
            console.error('For more information, please refer to https://www.digicert.com/ssl/. If you are absolutely certain of the identity of the server you are connecting to, you can use the --insecure flag to bypass this warning. Exiting...');
            process.exit(1);
        } else if (args.insecure && error.response && error.response.status === 500) {
            console.warn('Warning: Error: the SSL certificate of the server you are connecting to cannot be verified:');
            console.warn(error.message);
            console.warn('Running with --insecure flag, ignoring warning...');
        } else {
            console.error('Error:', error.message);
            process.exit(1);
        }
    }
}


function flatten(d, parentKey = '') {
    let items = [];
    for (const [k, v] of Object.entries(d)) {
        const newKey = parentKey ? `${parentKey}[${k}]` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            items = items.concat(Object.entries(flatten(v, newKey)));
        } else {
            items.push(`${newKey}=${v}`);
        }
    }
    items.sort();
    return items;
}

async function call(method, path, data, content = null, rawContent = null, options = {}, tryCount = 0) {
    //print out the request
    if (debug) {
        console.log("Request: ")
        console.log(method, path, data, content, rawContent, options);
    }

    const initData = { ...data };
    data['remote_user'] = username;
    data['timestamp'] = Math.floor(Date.now() / 1000).toString();

    const flatdata = flatten(data);
    let signed = Buffer.from(
        `${method}&${base_url.replace('https://', '').replace('http://', '')}${path}?${flatten(data).join('&')}`,
        'ascii'
    );

    const content_type = options['Content-Type'] || 'application/json';

    let inputcontent = null;
    if (content !== null && content_type === 'application/json') {
        inputcontent = JSON.stringify(content);
        signed = Buffer.concat([signed, Buffer.from(`&${inputcontent}`, 'ascii')]);
    } else if (rawContent !== null) {
        inputcontent = rawContent;
        signed = Buffer.concat([signed, Buffer.from('&', 'ascii'), inputcontent]);
    }

    const bkey = Buffer.from(apikey);
    data['signature'] = require('crypto')
        .createHmac('sha1', bkey)
        .update(signed)
        .digest('hex');

    const url = `${base_url}${path}?${flatten(data).join('&')}`;
    const headers = {
        Accept: 'application/json',
        'Content-Type': content_type,
    };

    let response = null;

    try {
        const axiosConfig = {
            method: method,
            url: url,
            headers: headers,
            data: inputcontent,
            timeout: worker_timeout * 1000,
            httpsAgent: insecure ? new (require('https').Agent)({ rejectUnauthorized: false }) : undefined,
        };

        response = await axios(axiosConfig);
    } catch (exc) {
        if (progress || debug) {
            console.log('Failure when attempting to call: ' + url);
            console.log('Retry attempt ' + (tryCount + 1));
        }
        if (debug) {
            console.log(exc);
        }
        if (tryCount < worker_retries) {
            await new Promise(resolve => setTimeout(resolve, 300 * 1000));
            return call(method, path, initData, content, rawContent, options, tryCount + 1);
        }

        throw exc;
    }

    if (response === null) {
        throw new Error('Client error');
    }

    const code = response.status;

    if (code !== 200 && (method !== 'post' || code !== 201)) {
        if (tryCount > worker_retries) {
            throw new Error('Http error ' + code + ' ' + response.data);
        } else {
            if (progress || debug) {
                console.log('Failure when attempting to call: ' + url);
                console.log('Retry attempt ' + (tryCount + 1));
            }
            if (debug) {
                console.log('Fail Reason: ' + code);
                console.log(response.data);
            }
            await new Promise(resolve => setTimeout(resolve, 300 * 1000));
            return call(method, path, initData, content, rawContent, options, tryCount + 1);
        }
    }

    if (response.data === '') {
        throw new Error('Http error ' + code + ' Empty response');
    }

    if (method !== 'post') {
        return response.data;
    }

    return {
        location: response.headers['location'],
        created: response.data,
    };
}


async function postTransfer(user_id, files, recipients, subject = null, message = null, expires = null, options = []) {
    //log out all the parameters
    if (debug) {
        console.log('user_id: ' + user_id);
        console.log('files: ' + files);
        console.log('recipients: ' + recipients);
        console.log('subject: ' + subject);
        console.log('message: ' + message);
        console.log('expires: ' + expires);
        console.log('options: ' + options);
    }

    if (expires === null) {
        expires = Math.floor(Date.now() / 1000) + default_transfer_days_valid * 24 * 3600;
    }



    const to = recipients.split(',').map(x => x.trim());

    return await call(
        'post',
        '/transfer',
        {},
        {
            from: user_id,
            files: files,
            recipients: to,
            subject: subject,
            message: message,
            expires: expires,
            aup_checked: 1,
            options: options
        },
        null,
        {}
    );
}


async function putChunk(t, f, chunk, offset) {
    return await call(
        'put',
        `/file/${f.id}/chunk/${offset}`,
        { key: f.uid, roundtriptoken: t.roundtriptoken },
        null,
        chunk,
        { 'Content-Type': 'application/octet-stream' }
    );
}

async function fileComplete(t, f) {
    return await call(
        'put',
        `/file/${f.id}`,
        { key: f.uid, roundtriptoken: t.roundtriptoken },
        { complete: true },
        null,
        {}
    );
}

async function transferComplete(transfer) {
    return await call(
        'put',
        `/transfer/${transfer.id}`,
        { key: transfer.files[0].uid },
        { complete: true },
        null,
        {}
    );
}

async function deleteTransfer(transfer) {
    return await call(
        'delete',
        `/transfer/${transfer.id}`,
        { key: transfer.files[0].uid },
        null,
        null,
        {}
    );
}

async function postGuest(user_id, recipient, subject = null, message = null, expires = null, options = []) {
    if (expires === null) {
        expires = Math.round(Date.now() / 1000) + (default_transfer_days_valid * 24 * 3600);
    }

    return await call(
        'post',
        '/guest',
        {},
        {
            from: user_id,
            recipient: recipient,
            subject: subject,
            message: message,
            expires: expires,
            aup_checked: 1,
            options: options
        },
        null,
        {}
    );
}




async function main() {

    await getConfigs();

    if (debug) {
        console.log("postTransfer");
    }

    if (guest) {
        console.log("creating new guest " + args.recipients);
        const troptions = { get_a_link: 0 };
        const r = await postGuest(
            username,
            args.recipients,
            args.subject,
            args.message,
            null,
            troptions
        );
        process.exit(0);
    }

    const files = {};
    const filesTransfer = [];
    for (const f of args.files) {
        const fn_abs = path.resolve(f);
        const fn = path.basename(fn_abs);
        const size = fs.statSync(fn_abs).size;

        files[fn + ":" + size] = {
            name: fn,
            size: size,
            path: fn_abs,
        };
        filesTransfer.push({ name: fn, size: size });
    }

    const troptions = { get_a_link: 0 };

    const transfer = (
        await postTransfer(
            username,
            filesTransfer,
            args.recipients,
            args.subject,
            args.message,
            null,
            troptions
        )
    ).created;

    try {
        for (const f of transfer.files) {
          const path = files[`${f.name}:${f.size}`].path;
          const size = files[`${f.name}:${f.size}`].size;
    
          if (debug) {
            console.log('putChunks: ' + path);
          }
    
          const fin = await fsp.open(path, 'r', 0);
    
          let progressedChunks = 0;
    
          const tasks = [];
    
          for (let i = 0; i < size; i += upload_chunk_size) {

            if (i + upload_chunk_size > size) {
                upload_chunk_size = size - i;
            }

            const chunk = await fin.read({ length: upload_chunk_size });
            tasks.push(async () => {
              await putChunk(transfer, f, chunk, i);
              if (progress) {
                progressedChunks += upload_chunk_size;
                console.log(
                  'Uploading: ' + path + ' ' + ' ' + Math.min(Math.round((progressedChunks / size) * 100), 100) + '%',
                );
              }
            });
          }
    
          await async.parallelLimit(tasks, worker_count);
    
          await fin.close();
        }

        if (debug) {
            console.log("transferComplete");
        }
        await transferComplete(transfer);
        if (progress) {
            console.log("Upload Complete");
        }
    } catch (error) {
        console.error(error);
        if (debug) {
            console.log("deleteTransfer");
        }
        await deleteTransfer(transfer);
    }

}

main();



