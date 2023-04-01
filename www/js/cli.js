import arg from 'arg';// Command line interface to be run through node.js

const XRegExp = require('xregexp');import { Blob } from 'buffer';

const http = require('https'); //used to download the config file
const fs = require('fs'); //used to save the config file

//Base url of the filesender instance we are connecting to
let base_url = 'https://cloudstor.aarnet.edu.au/sender'

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
        transfer.from = "johannes.nicholas@utas.edu.au";
        global.window.filesender.client.api_key = 'd3b86ee78594ff349b4b0fc1c8e76ec56e6769e990d3833cadf314e81d57d6c3';

        //add a file to the transfer
        const blob = new Blob(['This file was generated as a test.']);
	var errorHandler;
        transfer.addFile('test.txt', blob, errorHandler);
        transfer.addFile('test2.txt', blob, errorHandler);
	//console.log(errorHandler);

        //set the recipient
        //transfer.addRecipient('someone@example.com', undefined);
        transfer.addRecipient('joey@joeyn.dev', undefined);
    
        //set the expiry date for 7 days in the future
        let expiry = (new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
        //format as a string in the yyyy-mm-dd format
        transfer.expires = expiry.toISOString().split('T')[0];

        //set the security token
       // global.window.filesender.client.security_token = "6159a5677c7a5fd8b2437eac2eafdb3cbf57173ca90ee1bf760b253b70af3ffd";
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


