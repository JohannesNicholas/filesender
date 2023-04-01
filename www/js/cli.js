import arg from 'arg';// Command line interface to be run through node.js

const XRegExp = require('xregexp');import { Blob } from 'buffer';

const http = require('https'); //used to download the config file
const fs = require('fs'); //used to save the config file
const ini = require('ini') //used to parse the config file

//get the users home directory
const home = process.env.HOME || process.env.USERPROFILE;

//Get the API key and security token from ~/.filesender/filesender.py.ini
const user_config_file = fs.readFileSync(home + '/.filesender/filesender.py.ini', 'utf8');
const user_config = ini.parse(user_config_file);
const base_url = user_config['system']['base_url'];
const default_transfer_days_valid = user_config['system']['default_transfer_days_valid'];
const username = user_config['user']['username'];
const apikey = user_config['user']['apikey'];




const { JSDOM } = require( "jsdom" );
const { window } = new JSDOM( "", {url: base_url + "/?s=upload"} );
global.$ = global.jQuery = require( "jquery" )( window );

// Set up the global window object
global.window = global;

//get the config file
console.log("Downloading config...");
const file = fs.createWriteStream("filesender-config.js");


export function cli(args) {

const request = http.get(base_url+"/filesender-config.js.php", function(response) {
   response.pipe(file);

   // after download completed close filestream
   file.on("finish", () => {
        file.close();
        console.log("Config downloaded");

        ////get all the required files
        //var XRegExp = require('../lib/xregexp/xregexp-all.js');
        require('./filesender-config.js');
        require('./client.js');
        require('./filesender.js');
        require('./transfer.js');
        

        //add some required functions
        global.window.filesender.ui = {};
        global.window.filesender.ui.error = function(error,callback) {
            console.log('[error] ' + error.message);
            console.log(error);
        }
        global.window.filesender.ui.rawError = function(text) {
            console.log('[raw error] ' + text);
        }
        global.window.filesender.ui.log = function(message) {
            console.log('[log] ' + message);
        }
        global.window.filesender.ui.validators = {};
        global.window.filesender.ui.validators.email = /^[a-z0-9!#$%&'*+\/=?^_\`\{|\}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_\`\{|\}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,})$/i

        global.window.location = {}
        global.window.location.href = base_url + "/?s=upload";
        
        
        //create a new transfer
        var transfer = new global.window.filesender.transfer()
        transfer.from = username;
        global.window.filesender.client.api_key = apikey;

        //add a file to the transfer
        const blob = new Blob(['This file was generated as a test.']);
	var errorHandler;
        transfer.addFile('test.txt', blob, errorHandler);
        transfer.addFile('test2.txt', blob, errorHandler);
	//console.log(errorHandler);

        //set the recipient
        //transfer.addRecipient('someone@example.com', undefined);
        transfer.addRecipient(username, undefined); //transfer to yourself
    
        //set the expiry date for 7 days in the future
        let expiry = (new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
        //format as a string in the yyyy-mm-dd format
        transfer.expires = expiry.toISOString().split('T')[0];

        //set the security token
       // global.window.filesender.client.security_token = "TOKEN GOES HERE";
        global.window.filesender.client.authentication_required = true;

        //what do I need to do before starting the transfer to make it work?


        //start the transfer
        transfer.start();

   });
});

 let options = parseArgumentsIntoOptions(args);
 console.log(options);
}

function parseArgumentsIntoOptions(rawArgs) {
 const args = arg(
   {
     '--git': Boolean,
     '--yes': Boolean,
     '--install': Boolean,
     '-g': '--git',
     '-y': '--yes',
     '-i': '--install',
   },
   {
     argv: rawArgs.slice(2),
   }
 );
 return {
   skipPrompts: args['--yes'] || false,
   git: args['--git'] || false,
   template: args._[0],
   runInstall: args['--install'] || false,
 };
}


