if (typeof window === 'undefined')
    window = {}; // dummy window for use in webworkers

if (!('filesender' in window))
    window.filesender = {};
if (!('ui' in window.filesender)) {
    window.filesender.ui = {};
    window.filesender.ui.log = function(e) {
        console.log(e);
    }
}

Uint8Array.prototype.equals = function (a) {
    return this.length === a.length && this.every(function(value, index) { return value === a[index]});
}

window.filesender.crypto_app = function () {
    return {
        crypto_is_supported: true,
        crypto_chunk_size:   window.filesender.config.upload_chunk_size,
        crypto_iv_len:       window.filesender.config.crypto_iv_len,
        crypto_crypt_name:   window.filesender.config.crypto_crypt_name,
        crypto_hash_name:    window.filesender.config.crypto_hash_name,
        // random passwords should be 32 octects (256 bits) of entropy.
        crypto_client_entropy_octets: 32,
        crypto_random_password_octets: 32,
        crypto_gcm_per_file_iv_octet_size: 12, // used in v2019_gcm_* key_versions
        crypto_cbc_per_file_iv_octet_size: 16, // 128bits for CBC
        crypto_key_version_constants: {
            // constant values for crypto_key_version
            // newest version first, some metadata about the process
            // taken. The year (and maybe month) should give indication
            // that the later years are also the most desired version.
            v2019_gcm_importKey_deriveKey: 3, // AES-GCM otherwise same as v2018_importKey_deriveKey
            v2019_gcm_digest_importKey:    2, // AES-GCM otherwise same as v2017_digest_importKey
            v2018_importKey_deriveKey:     1, // AES-CBC
            v2017_digest_importKey:        0  // AES-CBC
        },
        crypto_password_version_constants: {
            // constant values for crypto_password_version_constants
            // newest version last, some metadata about the process
            // taken. The year (and maybe month) should give indication
            // that the later years are also the most desired version.
            //
            //
            // This uses the password text as it is given. This is the right
            // choice for a password that is entered by the user for example.
            // It is assumed that encoding to base64 or whatnot is not needed.
            //
            v2018_text_password: 1,
            //
            //
            // This version is for random generated passwords of 256 bits (32 octets)
            // in length. Encoding from this full octet range is performed to base64
            // and decoding will be done in decodePassword() to the original octet array.
            // This version also allows for the use of less password hashing rounds
            // because it is assumed that the password is already a good length random value.
            // As such, more or less hashing will not impact security.
            //
            v2019_generated_password_that_is_full_256bit: 2
        },

        /**
         * This turns a filesender chunkid into a 4 byte array
         * that can be used in GCM encryption. Note that the chunkid
         * is turned into a larger number in line with desirable cryto
         * properties. 
         * 
         * This translation is undone by extractChunkIDFromIV()
         * so the calling code can always think of chunkid=0 as the first
         * chunk and chunkid=1 as the second and so on even if they
         * are encoded as by this function as:
         *
         * encodedchunkid = chunkid*ceil(chunk-size-in-bytes / 16)
         *
         * for 4mb chunks this would become:
         *  chunkid   encodedchunkid
         *  0         0
         *  1         262144 
         *  2         262144*2
         *  3         262144*3
         */
        createChunkIDArray: function( chunkid ) {
            var ret = new Uint8Array(4);

            // encode the filesender chunkid for GCM
            chunkid = chunkid * Math.ceil(window.filesender.config.upload_chunk_size/16);

            // convert the encoded chunkid into 4 array octets.
            ret[0] = chunkid>>0  & 0xFF;
            ret[1] = chunkid>>8  & 0xFF;
            ret[2] = chunkid>>16 & 0xFF;
            ret[3] = chunkid>>24 & 0xFF;
            return ret;
        },

        extractChunkIDFromIV: function( iv ) {

            if( iv.length != 16 ) {
                return -1;
            }

            // convert 4 array octets back into an encoded chunkid
            var id = 0;
            id |= (iv[12] <<  0);
            id |= (iv[13] <<  8);
            id |= (iv[14] << 16);
            id |= (iv[15] << 24);

            // convert that encoded chunkid back into a filesender chunkid.
            id = id / Math.ceil(window.filesender.config.upload_chunk_size/16);
            
            return id;
        },
        
        /**
         * Create and return an IV of 16 octets (128 bits) constructed as follows:
         *    12 octets of entropy
         *     4 octets containing the chunkid
         *
         * This is based on Page 19 of OpenFortress 2018 document:
         *   "The suggested procedure for the case of FileSender is to combine 96 bits
         *    of random material with a 32-bit chunk counter to form a 128-bit IV."
         */
        createIVGCM: function( chunkid, encryption_details ) {
            var $this = this;

            if( !encryption_details.fileiv ||
                encryption_details.fileiv.length != $this.crypto_gcm_per_file_iv_octet_size ) {
                throw ({message: 'gcm_encryption_found_invalid_iv_length',
                        details: {}});
            }
            // 96 bits of entropy
            var ivrandom = encryption_details.fileiv;

            // 32 bits of counter from chunkid
            var ivcounter = $this.createChunkIDArray(chunkid);

            // merge these into return value
            var iv = new Uint8Array(16);
            iv.set(ivrandom);
            iv.set(ivcounter, ivrandom.length );

            return iv;
        },

        
        // generate numOctets 8bit bytes of of entropy, encoded as base64 for storage/transmission
        generateBase64EncodedEntropy: function( numOctets ) {
            var $this = this;
            var entropy = crypto.getRandomValues(new Uint8Array(numOctets));
            var encoding = 'base64';
            var ret = $this.encodeToString( entropy, encoding );
            return ret;
        },
        // decode the base64 encoded entropy string into an array for local use
        decodeBase64EncodedEntropy: function( b64data, numOctets ) {
            var $this = this;
            var decoded = atob( b64data );
            var raw = new Uint8Array( numOctets );
            raw.forEach((_, i) => {
                raw[i] = decoded.charCodeAt(i);
            });
            return raw;
        },
        generateClientEntropy: function() {
            var $this = this;
            return $this.generateBase64EncodedEntropy($this.crypto_client_entropy_octets);
        },
        decodeClientEntropy: function( b64data ) {
            var $this = this;
            return $this.decodeBase64EncodedEntropy(b64data,$this.crypto_client_entropy_octets);
        },
        getNumberOctetsForIV: function( key_version ) {
            var $this = this;
            var numOctets = $this.crypto_gcm_per_file_iv_octet_size;
            if( key_version == $this.crypto_key_version_constants.v2018_importKey_deriveKey ||
                key_version == $this.crypto_key_version_constants.v2017_digest_importKey )
            {
                numOctets = $this.crypto_cbc_per_file_iv_octet_size;
            }
            return numOctets;
        },        
        generateCryptoFileIV: function() {
            var $this = this;
            var numOctets = $this.getNumberOctetsForIV(
                window.filesender.config.encryption_key_version_new_files);
            return $this.generateBase64EncodedEntropy(numOctets);
        },
        decodeCryptoFileIV: function( b64data ) {
            var $this = this;
            var numOctets = $this.getNumberOctetsForIV(
                window.filesender.config.encryption_key_version_new_files);
            return $this.decodeBase64EncodedEntropy(b64data,numOctets);
        },
        
        
        
        generateVector: function () {
            return crypto.getRandomValues(new Uint8Array(16));
        },
        generateKey: function (chunkid, encryption_details, callback, callbackError) {
            var $this = this;
            var iv = this.generateVector();
            var password    = encryption_details.password;
            var key_version = encryption_details.key_version;
            var salt        = encryption_details.salt;
            var password_encoding = encryption_details.password_encoding;
            var password_version  = encryption_details.password_version;

            var decoded        = $this.decodePassword( password, password_version, password_encoding );
            var passwordBuffer = decoded.raw;
            var hashRounds     = window.filesender.config.encryption_password_hash_iterations_new_files;
            if( encryption_details.password_hash_iterations ) {
                hashRounds = encryption_details.password_hash_iterations;
            }
            var saltBuffer     = window.filesender.crypto_common().convertStringToArrayBufferView(salt);
            var efunc = function (e) {
                // error making a hash
                callbackError(e);
            };

            
            if( key_version == $this.crypto_key_version_constants.v2018_importKey_deriveKey )
            {

                crypto.subtle.importKey(
                    'raw', 
                    passwordBuffer,
                    {name: 'PBKDF2'}, 
                    false, 
                    ['deriveBits', 'deriveKey']
                ).then(function(dkey) {

                    crypto.subtle.deriveKey(
                        { "name": 'PBKDF2',
                          "hash": 'SHA-256',
                          "iterations": hashRounds,
                          "salt":       saltBuffer,
                        },
                        dkey,
                        { "name":   'AES-CBC',
                          "length": 256,
                          iv:       iv
                        },
                        false,                   // key is not extractable
                        [ "encrypt", "decrypt" ] // features desired
                    ).then(function (key) {
                    
                        callback(key, iv);
                    }, efunc );
                }, efunc );
            }

            if( key_version == $this.crypto_key_version_constants.v2019_gcm_importKey_deriveKey )
            {
                window.filesender.config.crypto_crypt_name = "AES-GCM";
                this.crypto_crypt_name = window.filesender.config.crypto_crypt_name;

                // IV has a predefined mix of entropy and chunk counter
                iv = $this.createIVGCM( chunkid, encryption_details );

                crypto.subtle.importKey(
                    'raw', 
                    passwordBuffer,
                    {name: 'PBKDF2'}, 
                    false, 
                    ['deriveBits', 'deriveKey']
                ).then(function(dkey) {

                    crypto.subtle.deriveKey(
                        { "name": 'PBKDF2',
                          "hash": 'SHA-256',
                          "iterations": hashRounds,
                          "salt":       saltBuffer,
                        },
                        dkey,
                        { "name":   'AES-GCM',
                          "length": 256
                          // Note that passing the IV here does nothing as we are not encrypting anything
                          // tested by passing a random value here that is not the same during a call from
                          // decryptBlob()
                        },
                        false,                   // key is not extractable
                        [ "encrypt", "decrypt" ] // features desired
                    ).then(function (key) {
                    
                        callback(key, iv);
                    }, efunc );
                }, efunc );

            }
            
            if( key_version == $this.crypto_key_version_constants.v2017_digest_importKey )
            {
                crypto.subtle.digest(
                    {name: this.crypto_hash_name},
                    passwordBuffer
                ).then( function (key) {
                    crypto.subtle.importKey("raw", key,
                                            {name: $this.crypto_crypt_name, iv: iv},
                                            false,
                                            ["encrypt", "decrypt"]
                                           ).then( function (key) {
                                               callback(key, iv);
                                           }, function (e) {
                                               // error making a key
                                               filesender.ui.log(e);
                                           });
                }),
                function (e) {
                    // error making a hash
                    filesender.ui.log(e);
                };
            }


            if( key_version == $this.crypto_key_version_constants.v2019_gcm_digest_importKey )
            {
                window.filesender.config.crypto_crypt_name = "AES-GCM";
                this.crypto_crypt_name = window.filesender.config.crypto_crypt_name;

                // IV has a predefined mix of entropy and chunk counter
                iv = $this.createIVGCM( chunkid, encryption_details );
                
                crypto.subtle.digest(
                    {name: this.crypto_hash_name},
                    passwordBuffer
                ).then( function (key) {
                    crypto.subtle.importKey("raw", key,
                                            { "name":   'AES-GCM', "length": 256 },
                                            false,
                                            ["encrypt", "decrypt"]
                                           ).then( function (key) {
                                               callback(key, iv);
                                           }, function (e) {
                                               // error making a key
                                               filesender.ui.log(e);
                                           });
                }),
                function (e) {
                    // error making a hash
                    filesender.ui.log(e);
                };
            }
            
            
        },
        encryptBlob: function (value, chunkid, encryption_details, callback, callbackError ) {
            var $this = this;
            var key_version = encryption_details.key_version;

            // GCM checks
            if( key_version == $this.crypto_key_version_constants.v2019_gcm_digest_importKey ||
                key_version == $this.crypto_key_version_constants.v2019_gcm_importKey_deriveKey )
            {
                // If the user tries to upload too many bytes
                // than we should for this encryption technique
                // then do not allow it to happen.
                // Other checks should stop the code before this code can
                // run, but more checks are always better
                if( value.byteLength + chunkid*$this.crypto_chunk_size
                    > window.filesender.config.crypto_gcm_max_file_size )
                {
                    return callbackError({message: 'maximum_encrypted_file_size_exceeded',
                                          details: {}});
                }
            }
            
            this.generateKey(chunkid, encryption_details, function (key, iv) {
                crypto.subtle.encrypt({name: $this.crypto_crypt_name, iv: iv}, key, value).then(
                    function (result) {
                        
                            var joinedData = window.filesender.crypto_common().joinIvAndData(iv, new Uint8Array(result));

                            // this is the base64 variant. this will result in a larger string to send
                            var btoaData = btoa(
                                // This string contains all kind of weird characters
                                window.filesender.crypto_common().convertArrayBufferViewtoString(
                                        joinedData
                                    )
                                );

                            callback(btoaData);
                        },
                        function (e) {
                            // error occured during crypt
                            filesender.ui.log(e);
                        }
                );
            },
            function (e) {
                // error occured during generatekey
                filesender.ui.log(e);
            });
        },
        decryptBlob: function (value, encryption_details, callbackDone, callbackProgress, callbackError) {
            var $this = this;
            var key_version = encryption_details.key_version;
            var client_entropy = new Uint8Array(16);
            var expected_fixed_chunk_iv = new Uint8Array(16);

            if( key_version == $this.crypto_key_version_constants.v2019_gcm_digest_importKey ||
                key_version == $this.crypto_key_version_constants.v2019_gcm_importKey_deriveKey )
            {
                if( encryption_details.fileiv.length != $this.crypto_gcm_per_file_iv_octet_size )
                {
                    return callbackError({message: 'decryption_verification_failed_bad_fixed_iv',
                                          details: {}});
                }
                expected_fixed_chunk_iv = encryption_details.fileiv;
            }

            // decode client entropy if we have it
            if( encryption_details.client_entropy &&
                encryption_details.client_entropy.length )
            {
                client_entropy = $this.decodeClientEntropy( encryption_details.client_entropy );
            }

            var encryptedData = value; // array buffers array
            var blobArray = [];

            try {
                var chunkid = 0;
                this.generateKey(chunkid, encryption_details, function (key) {
		    var wrongPassword = false;
		    var decryptLoop = function(i) {
                        
		        callbackProgress(i,encryptedData.length); //once per chunk
                        var value = window.filesender.crypto_common().separateIvFromData(encryptedData[i]);

                        // GCM checks
                        if( key_version == $this.crypto_key_version_constants.v2019_gcm_digest_importKey ||
                            key_version == $this.crypto_key_version_constants.v2019_gcm_importKey_deriveKey )
                        {
                            
                            // Check IV random 96 bits are the same
                            if( !expected_fixed_chunk_iv.equals(value.iv.slice(0,$this.crypto_gcm_per_file_iv_octet_size))  ) {
                                return callbackError({message: 'decryption_verification_failed_invalid_iv',
                                                      details: {}});
                            }
                            
                            // Check that chunkid from IV matches expected chunkid
                            var ivchunkid = $this.extractChunkIDFromIV( value.iv );
                            if( ivchunkid == -1 ) {
                                return callbackError({message: 'decryption_verification_failed_bad_ivchunkid',
                                                      details: {}});
                            }
                            if( i != ivchunkid ) {
                                return callbackError({message: 'decryption_verification_failed_unexpected_ivchunkid',
                                                      details: {}});
                            }
                        }
                        
                        
                        crypto.subtle.decrypt({name: $this.crypto_crypt_name, iv: value.iv}, key, value.data).then(
                            function (result) {
                                var blobArrayBuffer = new Uint8Array(result);
                                blobArray.push(blobArrayBuffer);
                                // done
                                if (blobArray.length === encryptedData.length) {
                                    callbackDone(blobArray);
                                } else {
                                    if (i<encryptedData.length){
                                        setTimeout(decryptLoop(i+1),300);
                                    }
                                }
                            },
                            function (e) {
                                if (!wrongPassword) {
                                    wrongPassword=true;
                                    callbackError(e);
                                }
                            }
		        );
                    };
		    decryptLoop(0);
                },
                function (e) {
                    // error occured during generatekey
                    filesender.ui.log(e);
                });
            }
            catch(e) {
                callbackError(e);                
            }            
        },
        /**
         *
         * @param fileiv is the decoded fileiv. Decoding can be done with decodeCryptoFileIV()
         */
        decryptDownload: function (link, mime, name, key_version, salt,
                                   password_version, password_encoding, password_hash_iterations,
                                   client_entropy, fileiv,
                                   progress) {
            var $this = this;
            var prompt = filesender.ui.prompt(window.filesender.config.language.file_encryption_enter_password, function (password) {
                var pass = $(this).find('input').val();

                // Decrypt the contents of the file
                var oReq = new XMLHttpRequest();
                oReq.open("GET", link, true);
                oReq.responseType = "arraybuffer";

                //Download progress
                oReq.addEventListener("progress", function(evt){
                        if (evt.lengthComputable) {
                                var percentComplete = Math.round(evt.loaded / evt.total *10000)/100;
                                if (progress) progress.html(window.filesender.config.language.downloading+": "+percentComplete.toFixed(2)+" %");
                        }
                }, false);

                //on file arrived
                oReq.onload = function (oEvent) {
                        if (progress){
                            progress.html(window.filesender.config.language.decrypting+"...");
                        }
                        // hands over to the decrypter
                        var arrayBuffer = new Uint8Array(oReq.response);
                        setTimeout(function(){
                            $this.decryptBlob(
                                window.filesender.crypto_blob_reader().sliceForDownloadBuffers(arrayBuffer),
                                { password: pass,
                                  key_version: key_version, salt: salt,
                                  password_version:  password_version,
                                  password_encoding: password_encoding,
                                  password_hash_iterations: password_hash_iterations,
                                  client_entropy: client_entropy,
                                  fileiv: fileiv
                                },
                                function (decrypted) {
                                    var blob = new Blob(decrypted, {type: mime});
                                    saveAs(blob, name);
                                    if (progress) {
                                        progress.html("");
                                    }
                                },
                                function (i,c) {
                                    var percentComplete = Math.round(i / c *10000)/100;
                                    if (progress) {
                                        progress.html(window.filesender.config.language.decrypting+": "+percentComplete.toFixed(2)+" %");
                                    }
                                },
                                function (error) {
                                    alert(window.filesender.config.language.file_encryption_wrong_password);
                                    if (progress){
                                        progress.html(window.filesender.config.language.file_encryption_wrong_password);
                                    }
                                }
                            );
                        }, 300);
                };
                // create download
                oReq.send();

            }, function(){
                filesender.ui.notify('info', window.filesender.config.language.file_encryption_need_password);
            });

            // Add a field to the prompt
            var input = $('<input type="text" class="wide" />').appendTo(prompt);
            input.focus();
        },
        /**
         * Get secure random bytes of a given length
         * @param number of octets of random data to get
         * @return Uint8Array containing your random data of random data
         */
        generateSecureRandomBytes: function( len ) {
            var entropybuf = new Uint8Array(len);
            window.crypto.getRandomValues(entropybuf);
            return entropybuf;
        },

        /**
         * Genereate a random password that is of a good length
         * for the encryption being used and encode it. 
         * @return an object with the length, password encoding version,
         * and encoded and raw password. 
         *
         * Note that you will need to pass the following back to decodePassword()
         * in order to recalculate the ret.raw values.
         * List of items to store/restore.
         *    ret.value, 
         *    ret.encoding, 
         *    ret.version to 
         * 
         * Example return value.
         * {
         *    version:      1,
         *    encoding:     'base64',
         *    raw:          Buffer <88, 39,...>,
         *    raw_length:   32,
         *    value:        'string encoded version of raw',
         *    value_length: 64
         * }
         */
        generateRandomPassword: function()
        {
            var $this = this;
            var ret = new Object();
            var password = 'error';
            var entropybuf;
            var encoding = filesender.config.encryption_generated_password_encoding;

            var desired_version = filesender.config.encryption_random_password_version_new_files;
            if( $this.crypto_password_version_constants.v2018_text_password == desired_version ) {
                // This is the password generation in place through 
                // the first half of 2019.
                var desiredPassLen = filesender.config.encryption_generated_password_length;
                entropybuf = $this.generateSecureRandomBytes( desiredPassLen );
                password = $this.encodeToString( entropybuf, encoding );
                password = password.substr(0,desiredPassLen);
            }
            else if( $this.crypto_password_version_constants.v2019_generated_password_that_is_full_256bit == desired_version ) {

                // A 32 byte (256 bit) random password
                // encoded using the administrators desired encoding
                encoding = 'base64';
                var entropybuf = $this.generateSecureRandomBytes( $this.crypto_random_password_octets );
                password = $this.encodeToString( entropybuf, encoding );
            }
            else {
                filesender.ui.rawError('{bad password encoding set, you should never see this error}')
            }
            
            ret.version      = desired_version;
            ret.raw          = entropybuf;
            ret.raw_length   = entropybuf.length;
            ret.encoding     = encoding;
            ret.value        = password;
            ret.value_length = ret.value.length;
            
            return ret;
        },

        /**
         * Decode an object that was generated with generateRandomPassword
         * or a raw string as it is presented by using version == 1
         *
         * Example passed input object.
         * {
         *    version:      2,
         *    encoding:     'base64',
         *    value:        'string encoded version of raw',
         * }
         *
         * The output will have raw and raw_length set from input.
         */
        decodePassword: function( value, version, encoding )
        {
            var $this = this;
            var ret = new Object();
            var raw = new Uint8Array(0);

            if( $this.crypto_password_version_constants.v2018_text_password == version ) {
                raw = window.filesender.crypto_common().convertStringToArrayBufferView(value);
            }
            else if( $this.crypto_password_version_constants.v2019_generated_password_that_is_full_256bit == version ) {
                if( encoding == 'base64' ) {
                    try {
                        var decoded = atob( value );
                        raw = new Uint8Array( $this.crypto_random_password_octets );
                        raw.forEach((_, i) => {
                            raw[i] = decoded.charCodeAt(i);
                        });
                    } catch(e) {
                        // we know the password is invalid bad if we can not base64 decode it
                        // after all, we base64 encoded it in generateRandomPassword().
                        throw(window.filesender.config.language.file_encryption_wrong_password);
                    }
                }
            }
            else {
                filesender.ui.rawError('{bad password encoding set, you should never see this error}')
            }
            
            ret.version      = version;
            ret.raw          = raw;
            ret.raw_length   = raw.length;
            ret.encoding     = encoding;
            ret.value        = value;
            ret.value_length = ret.value.length;
                
            return ret;
        },
        
        /**
         * This should encode to 'HelloWorld'
         */
//        encodeToAscii85( [0x86, 0x4F, 0xD2, 0x6F, 0xB5, 0x59, 0xF7, 0x5B] );
        /**
         * binary data to ascii 85 converter using the Z85 encoding. 
         * This encodes 4 octets into 5 bytes of presentable text.
         *
         * Note that bindata will be padded with 0 bytes if it was not an even
         * multiple of 4 bytes.
         *
         * https://en.wikipedia.org/wiki/Ascii85
         * 
         * @param bindata Uint8Array containing data binary data to convert. 
         * @return a Z85 encoded string containing bindata 
         * @see encodeToString() for a dispatch function
         */
        encodeToAscii85: function (bindata) {

            var a85encTable = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";

            // allow for zero padding to cater for
            // data that is not an array length of mulitples of 4
            var datalen = bindata.length;
            var paddinglength = 0;
            if( datalen % 4 ) {
                paddinglength = 4 - ( datalen % 4 );
                datalen += paddinglength;
            }

            // allocate with padding (zeros) and copy
            // bindata over the start of the array
            var data = new Uint8Array(datalen);
            data.set( bindata );
            
            var size = data.length;
            var encodedSize = data.length * 5/4;
            var encoded = "";
            var value = 0;
            var i = 0;

            // transform 4 bytes of data at a time to 5 bytes of output
            for( i=0; i<size; i+= 4 ) {

                value = data[i]*256*256*256 + data[i+1]*256*256 + data[i+2]*256 + data[i+3];
                var divisor = 85 * 85 * 85 * 85;
                while (divisor >= 1) {
                    encoded += a85encTable[ Math.floor(value / divisor) % 85 ];

                    // do not go fractional
                    if( divisor==1 ) {
                        break;
                    }
                    divisor /= 85;
                }
            }

            return encoded;
        },
        /**
         * convert array to base64 encoded string
         * @param bindata Uint8Array containing data binary data to convert. 
         * @return a base64 encoded string containing bindata 
         * @see encodeToString() for a dispatch function
         */
        encodeToBase64: function (bindata) {
            return btoa(String.fromCharCode.apply(null, bindata)); 
        },
        /**
         * encode the bindata using the named encoding or base64 by default.
         * @param bindata Uint8Array containing data binary data to convert. 
         * @param encoding ascii85 or base64 as a string
         */
        encodeToString: function( bindata, encoding ) {
            var $this = this;
            if( encoding == "ascii85" ) {
                return $this.encodeToAscii85( bindata );
            }
            return $this.encodeToBase64( bindata );
        },

        /**
         * Check file size for encryption limits
         *
         * @return true if things are ok
         */
        isFileSizeValidForEncryption: function( size ) {
            var $this = this;

            var key_version = window.filesender.config.encryption_key_version_new_files;
        
            if( key_version == $this.crypto_key_version_constants.v2019_gcm_digest_importKey ||
                key_version == $this.crypto_key_version_constants.v2019_gcm_importKey_deriveKey )
            {
                if( size > window.filesender.config.crypto_gcm_max_file_size ) {
                    return false;
                }
            }
            
            return true;
        }
    };
};
