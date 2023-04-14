import arg from 'arg';// Command line interface to be run through node.js
import { Blob } from 'buffer';

const http = require('https'); //used to download the config file
const fs = require('fs'); //used to save the config file
const ini = require('ini') //used to parse the config file

//get the users home directory
const home = process.env.HOME || process.env.USERPROFILE;

//Get the API key and security token from ~/.filesender/filesender.py.ini
const user_config_file = fs.readFileSync(home + '/.filesender/filesender.py.ini', 'utf8');

const user_config = ini.parse(user_config_file);
const base_url = user_config['system']['base_url'].split('/').slice(0, -1).join('/');
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

  let options = parseArgumentsIntoOptions(args);

const request = http.get(base_url+"/filesender-config.js.php", function(response) {
   response.pipe(file);

   // after download completed close filestream
   file.on("finish", () => {
        file.close();
        console.log("Config downloaded");

        ////get all the required files
        require('../filesender-config.js');
        require('../../www/js/client.js');
        require('../../www/js/filesender.js');
        require('../../www/js/transfer.js');

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
        global.window.filesender.client.from = username;
        global.window.filesender.client.remote_user = username;
        transfer.from = username;

	//Turn on reader support for API transfers
        global.window.filesender.supports.reader = true;
	global.window.filesender.client.api_key = apikey;

       // global.window.filesender.config.terasender_enabled = true;
        

//        const blob = new Blob(['This file was generated as a test.']);
//        transfer.addFile('test.txt', blob, errorHandler);

	//create a blob from a file
        var blob = new Blob([fs.readFileSync('test.txt')]);

        var errorHandler;
        transfer.addFile('test.txt', blob, errorHandler);
        transfer.addFile('test2.txt', blob, errorHandler);

        //set the recipient
        //transfer.addRecipient(username, undefined);

        //add the recipients
        for (var i = 0; i < options.recipients.length; i++) {
            transfer.addRecipient(options.recipients[i], undefined);
        }
    
        //set the expiry date for 7 days in the future
        let expiry = (new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
        //format as a string in the yyyy-mm-dd format
        transfer.expires = expiry.toISOString().split('T')[0];

        //set the security token
        //global.window.filesender.client.authentication_required = true;

        //start the transfer
        transfer.start();

   });
});

}

function parseArgumentsIntoOptions(rawArgs) {
 const args = arg(
   {
     '--verbose': Boolean,
     '--insecure': Boolean,
     '--progress': Boolean,
     '--subject': String,
     '--message': String,
     '--username': String,
     '--apikey': String,
     '--recipients': [ String ],
     '-v': '--verbose',
     '-p': '--progress',
     '-i': '--insecure',
     '-s': '--subject',
     '-m': '--message',
     '-u': '--username',
     '-a': '--apikey',
     '-r': '--recipients',
   },
   {
     argv: rawArgs.slice(2),
   }
 );
 console.log(args);
 return {
   skipPrompts: args['--yes'] || false,
   git: args['--git'] || false,
   template: args._[0],
   runInstall: args['--install'] || false,
   recipients: args['--recipients'] || [],
 };
}