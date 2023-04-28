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

const file = fs.createWriteStream("filesender-config.js");


export function cli(args) {

  let options = parseArgumentsIntoOptions(args);
  if (options.verbose) console.log("Downloading config...");

  if (options.files.length == 0) {
    console.log("No files specified");
    console.log("Use '--file ./file1.txt' to specify a file to upload");
    return;
  }

  if (options.recipients.length == 0) {
    console.log("No recipients specified");
    console.log("Use '--recipient someone@example.com' to specify a recipient for the transfer");
    return;
  }

  if (options.apikey != undefined){
    apikey = options.apikey;
  }

  if (options.username != undefined){
    username = options.username;
  }

  if (!options.verbose) process.stdout.write("Getting config...")

const request = http.get(base_url+"/filesender-config.js.php", function(response) {
   response.pipe(file);

   // after download completed close filestream
   file.on("finish", () => {
        file.close();
        if (options.verbose) console.log("Config downloaded");
        if (!options.verbose) process.stdout.write("uploading...")

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
          if (options.verbose)
            console.log('[log] ' + message);
        }
        global.window.filesender.log = function(message) {
          if (options.verbose)
            console.log('[logger] ' + message);
        }
        global.window.filesender.ui.validators = {};
        global.window.filesender.ui.validators.email = /^[a-z0-9!#$%&'*+\/=?^_\`\{|\}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_\`\{|\}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,})$/i

        global.window.location = {}
        global.window.location.href = base_url + "/?s=upload";
        

	      //Turn on reader support for API transfers
        global.window.filesender.client.from = username;
        global.window.filesender.client.remote_user = username;
        global.window.filesender.supports.reader = true;
	      global.window.filesender.client.api_key = apikey;

        //lists all the transfers
        global.window.filesender.client.getTransfer("@me", null, null, null).then(function(transfers) {
          console.log(transfers.length + " transfers found");
          return;
        });
        return;
                
                
        
        //create a new transfer
        var transfer = new global.window.filesender.transfer()
        transfer.from = username;
        



        // global.window.filesender.config.terasender_enabled = true;
        

        //Add the files
        var errorHandler;
        for (var i = 0; i < options.files.length; i++) {
            var blob = new Blob([fs.readFileSync(options.files[i])]);
            //get the file name without the path, supports both unix and windows paths
            var filename = options.files[i].split('/').pop().split('\\').pop();
            transfer.addFile(filename, blob, errorHandler);
        }

        //add the recipients
        for (var i = 0; i < options.recipients.length; i++) {
            transfer.addRecipient(options.recipients[i], undefined);
        }

        // add the subject
        transfer.subject = options.subject;

        //add message
        transfer.message = options.message;
    
        // set the expiry date to the daysValid argument if exists, otherwise use default value in config file
        let daysValid = options.daysValid ? options.daysValid : default_transfer_days_valid
        let expiry = (new Date(Date.now() + daysValid * 24 * 60 * 60 * 1000));
        // format as a string in the yyyy-mm-dd format
        transfer.expires = expiry.toISOString().split('T')[0];
        global.window.filesender.ui.log(`File will be valid until ${transfer.expires}, (${daysValid} day(s) from now)`)

        //set the security token
        //global.window.filesender.client.authentication_required = true;

        //start the transfer
        transfer.start();

        transfer.oncomplete = function( transfer, time ) {
          if (!options.verbose) process.stdout.write("done.")
        }
        
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
     '--file': [ String ],
     '--daysValid' : [ Number],
     '-v': '--verbose',
     '-p': '--progress',
     '-i': '--insecure',
     '-s': '--subject',
     '-m': '--message',
     '-u': '--username',
     '-a': '--apikey',
     '-r': '--recipients',
     '-f': '--file',
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
   recipients: args['--recipients'] || [],
   files : args['--file'] || [],
   message : args['--message'] || "",
   subject : args['--subject'] || "",
   daysValid : args['--daysValid'],
   verbose: args['--verbose'] || false,
   apikey: args['--apikey'],
   username: args['--username'],
 };
}