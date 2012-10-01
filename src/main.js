"use strict";
var quby = window['quby'] || {};

(function( quby, util ) {
    /**
     * Main
     *
     * Entry point for running the parser. Also handles recording
     * which is the current parser (to allow them to run
     * recursively).
     *
     * Users should simply call the 'parse' entry point
     * function for starting the parser.
     */
    quby.main = {
        runScriptTagsDisplay: function() {
            quby.main.runScriptTags( function(r) {
                r.runOrDisplayErrors();
            } );
        },

        /**
         * Looks for scripts tags with the type
         * 'text/quby'. They are then pulled out,
         * and parsed in order.
         *
         * The result is then passed into the
         * callback given.
         *
         * If no callback is given, then the result
         * is just run automatically, or throws an
         * error if the source is incorrect.
         */
        runScriptTags: function( onResult ) {
            if ( ! onResult ) {
                onResult = function( result ) {
                    if ( result.hasErrors() ) {
                        throw new Error( result.errors[0] );
                    } else {
                        result.run();
                    }
                };
            }

            var scripts = document.getElementsByTagName( 'script' );
            var parser  = new quby.main.Parser();

            var inlineScriptCount = 1;

            for ( var i = 0; i < scripts.length; i++ ) {
                var script = scripts[i],
                    name   = script.getAttribute('data-name') || null,
                    type   = script.getAttribute('type');

                if ( type === 'text/quby' || type === 'quby' ) {
                    var instance = null;
                    var isAdmin = ( script.getAttribute( 'data-admin' ) === 'true' ) ?
                            true  :
                            false ;

                    var contents = script.innerHTML;

                    // inlined tags
                    if ( contents !== '' && contents !== undefined ) {
                        /**
                         * If no name given, work out a suitable one.
                         */
                        if ( name === null ) {
                            if ( script.id ) {
                                name = '#' + script.id;
                            } else if ( script.className ) {
                                name = '.' + util.trim( script.className.replace(/ +/g, ', .') );
                            } else {
                                name = 'inline script ' + inlineScriptCount++;
                            }
                        }

                        // remove the CDATA wrap, if present
                        contents = contents.
                              replace(/^\/\/<!\[CDATA\[/, "").
                              replace(/\/\/\]\]>$/, "");

                        instance = parser.parse( contents );

                    // src tags
                    } else {
                        var src = script.getAttribute('src');

                        if ( src === undefined ) {
                            throw new Error('cannot read script tag');
                        } else {
                            instance = parser.parseUrl( src );
                        }
                    }

                    instance.adminMode( isAdmin );
                    if ( name !== null ) {
                        instance.name( name );
                    }
                }
            }

            parser.finalize( onResult );
        },

        /**
         *
         */
        parse: function( source, adminMode, callback ) {
            var parser = new quby.main.Parser();

            parser.
                    parse( source ).
                    adminMode( adminMode );
            parser.finalize( callback );
        },

        ParserInstance: (function() {
            var ParserInstance = function( source ) {
                this.source = source ?
                        new SourceLines( source ) :
                        null ;

                this.isStrict = true ;
                this.isAdmin  = false;

                this.whenFinished  = null;
                this.debugCallback = null;

                this.strName = '<Unknown Script>';

                this.isExplicitelyNamed = false;

                this.hasParsed = false;

                Object.preventExtensions( this );
            }

            var ensureCanParse = function( instance ) {
                if ( instance.hasParsed ) {
                    throw new Error( "adding new properties to an instance which has finished parsing" );
                }
            }

            ParserInstance.prototype = {
                    adminMode: function( isAdmin ) {
                        ensureCanParse( this );

                        this.isAdmin = ( arguments.length > 0 ) ?
                                !! isAdmin :
                                false ;

                        return this;
                    },

                    /**
                     * Disables strict mode for the current bout of parsing.
                     */
                    strictMode: function( isStrict ) {
                        ensureCanParse( this );

                        this.isStrict = ( arguments.length > 0 ) ?
                                !! isStrict :
                                true ;

                        return this;
                    },

                    /**
                     * Gives this parser a name, for use in the error messages.
                     * i.e. 'main.qb', or 'some-game'.
                     *
                     * The name can be anything you want.
                     */
                    name: function( name, isExplicitelyNamed ) {
                        ensureCanParse( this );

                        this.strName = name;

                        this.isExplicitelyNamed = arguments.length > 1 ?
                                isExplicitelyNamed :
                                true ;

                        return this;
                    },

                    /**
                     * A callback to run for when *just this file*
                     * has finished being parsed.
                     *
                     * Note that this will happen before you call
                     * 'finalise'.
                     */
                    finish: function( fun ) {
                        ensureCanParse( this );

                        this.whenFinished = fun;

                        return this;
                    },

                    /**
                     * If a debugCallback is provided, then it will be called during
                     * the parsing process. This makes parsing a tad slower, but provides
                     * you with information on how it wen't (like the symbols generated
                     * and how long the different stages took).
                     *
                     * If no debugCallback is provided, then it is run normally.
                     */
                    debug: function( fun ) {
                        ensureCanParse( this );

                        this.debugCallback = fun;

                        return this;
                    }
            }

            return ParserInstance;
        })(),

        /**
         * This is for using multiple parsers together, for parsing multiple files.
         *
         * You can imagine a program is built from multiple files.
         * This is how parsing is based; you call a method to provide
         * a file until they are all provided. Then you call 'finalize'
         * to finish compilation and generate the actual JS application.
         *
         * Some of these files may have different permissions;
         * core files with admin rights, and user files without these rights.
         * The various methods allow you to state what can do what.
         * 
         * 'Strict mode' adds some extra errors, for common bugs.
         * This is mostly used to cover up differences between versions,
         * where having strict mode off, will try not to error on a
         * breaking change (if possible).
         * 
         * It also adds errors for some common code bugs.
         */
        Parser: (function () {
            var Parser = function() {
                this.validator = new quby.core.Validator();
                this.isStrict  = true;

                Object.preventExtensions( this );
            };

            var newParserInstance = function( parser, src ) {
                var instance = new quby.main.ParserInstance( src );

                instance.strictMode( parser.isStrict );

                return instance;
            };

            Parser.prototype = {
                    /**
                     * Enabled strict mode, for all parsing,
                     * which is on by default.
                     *
                     * Note that you can disable it for indevidual
                     * files with 'strictMode'.
                     */
                    strictModeAll: function( isStrict ) {
                        if ( arguments.length === 0 ) {
                            isStrict = true;
                        }

                        this.isStrict = isStrict;
                    },

                    /**
                     * Parse a single file, adding it to the program being built.
                     *
                     * A ParseInstance is returned, allowing you to customize
                     * the setup of how the files should be parsed.
                     */
                    parse: function( source ) {
                        var instance  = newParserInstance( this, source ),
                            validator = this.validator;

                        util.future.run(
                                function() {
                                    quby.core.runParser( instance, validator );
                                }
                        );

                        return instance;
                    },

                    parseUrl: function( url ) {
                        var instance     = newParserInstance( this ),
                            validator    = this.validator,
                            name         = util.url.stripDomain(url),
                            questionMark = name.indexOf('?');

                        if ( questionMark !== -1 ) {
                            name = name.substring( 0, questionMark );
                        }

                        instance.name( name );

                        util.ajax.getFuture(
                                url,
                                function(status, text) {
                                    if ( status >= 200 && status < 400 ) {
                                        instance.source = new SourceLines( text );

                                        quby.core.runParser( instance, validator );
                                    } else {
                                        throw new Error( "failed to load script: " + url );
                                    }
                                }
                        );

                        return instance;
                    },

                    parseArgs: function( source, adminMode, callback, debugCallback ) {
                        return this.
                                parse( source ).
                                adminMode( adminMode ).
                                finish( callback ).
                                debug( debugCallback );
                    },

                    parseSources: function(sources, adminMode, callback) {
                        var _this = this;
                        util.future.map( sources, function(source) {
                            _this.parse( source, adminMode );
                        } );

                        if ( callback != undefined ) {
                            util.future.runFun( callback );
                        }
                    },

                    /**
                     * Call when you are done parsing files.
                     * 
                     * This finishes the process, and
                     * finalises the program.
                     * 
                     * The callback given is then called
                     * with the resulting program, or errors.
                     *
                     * As a UK citizen, spelling this 'finalize',
                     * makes me feel dirty : ( .
                     */
                    finalize: function( callback ) {
                        var _this = this;

                        util.future.run(
                                function() {
                                    var output = _this.validator.finaliseProgram();
                                    var result = new quby.main.Result(
                                            output,
                                            _this.validator.getErrors()
                                    );

                                    util.future.runFun( function() {
                                        callback( result );
                                    } );
                                }
                        );
                    }
            };

            return Parser;
        })(),

        /**
         * Result
         *
         * Handles creation and the structures for the object you get back from the parser.
         *
         * Essentially anything which crosses from the parser to the caller is stored and
         * handled by the contents of this script.
         */
        Result: (function() {
            var Result = function( code, errors ) {
                this.program = code;
                this.errors  = errors;

                // default error behaviour
                this.onErrorFun = function( ex ) {
                    var errorMessage = ex.name + ': ' + ex.message;

                    if ( ex.stack ) {
                        errorMessage += '\n\n' + ex.stack;
                    }

                    alert( errorMessage );
                };
            };

            Result.prototype = {
                /**
                 * Sets the function to run when this fails to run.
                 * By default this is an alert message displaying the error that has
                 * occurred.
                 *
                 * The function needs one parameter for taking an Error object that was
                 * caught.
                 *
                 * @param fun The function to run when an error has occurred at runtime.
                 */
                setOnError: function( fun ) {
                    this.onErrorFun = fun;
                },

                /**
                 * @return Returns the Quby application in it's compiled JavaScript form.
                 */
                getCode: function() {
                    return this.program;
                },

                /**
                 * @return True if there were errors within the result, otherwise false if there are no errors.
                 */
                hasErrors: function() {
                    return this.errors.length > 0;
                },

                getErrors: function() {
                    return this.errors;
                },

                runOrDisplayErrors: function() {
                    if ( this.hasErrors() ) {
                        this.displayErrors();
                    } else {
                        this.run();
                    }
                },

                /**
                 * This will display all of the errors within the
                 * current web page.
                 *
                 * This is meant for development purposes.
                 */
                displayErrors: function() {
                    var errors = this.getErrors();

                    var iframe = document.createElement('iframe');
                    iframe.setAttribute('width', '800px');
                    iframe.setAttribute('height', '400px');
                    iframe.setAttribute('frameborder', '0');
                    iframe.setAttribute('src', 'about:blank');

                    iframe.style.transition =
                    iframe.style.OTransition =
                    iframe.style.MsTransition =
                    iframe.style.MozTransition =
                    iframe.style.WebkitTransition = 'opacity 200ms linear';

                    iframe.style.background = 'transparent';
                    iframe.style.opacity = 0;
                    iframe.style.zIndex = 100000;
                    iframe.style.top = '100px';
                    iframe.style.right = 0;
                    iframe.style.left = '50%';
                    iframe.style.bottom = 0;
                    iframe.style.position = 'fixed';
                    iframe.style.marginLeft = '-400px';

                    iframe.onload = function() {
                        var iDoc = iframe.contentWindow || iframe.contentDocument;

                        if ( iDoc.document) {
                            iDoc = iDoc.document;
                        }

                        var html = [];

                        html.push( '<div style="background: rgba(0,0,0,0.5); border-radius: 4px; width: 100%; height: 100%; position: absolute; top: 0; left: 0;">' );
                            html.push( '<div style="width: 700px; margin: 12px auto; scroll: auto; color: whitesmoke; font-family: \'DejaVu Sans Mono\', monospaced; font-size: 14px;">' );
                                var currentName = null;

                                for ( var i = 0; i < errors.length; i++ ) {
                                    var error = errors[i],
                                        name  = error.name;

                                    if ( currentName !== name ) {
                                        html.push( '<h1>' );
                                        html.push( util.htmlToText(name) );
                                        html.push( '</h1>' );

                                        currentName = name;
                                    }

                                    html.push( '<div style="width: 100%">' )
                                    html.push( error.message )
                                    html.push( '</div>' );
                                }
                            html.push( '</div>' );
                        html.push( '</div>' );

                        var iBody = iDoc.getElementsByTagName( 'body' )[0];
                        iBody.innerHTML = html.join('');
                        iBody.style.margin  = 0;
                        iBody.style.padding = 0;

                        iframe.style.opacity = 1;
                    }

                    var body = document.getElementsByTagName( 'body' )[0];
                    if ( body ) {
                        body.appendChild( iframe );
                    } else {
                        setTimeout( function() {
                            document.getElementsByTagName( 'body' )[0].appendChild( iframe );
                        }, 1000 );
                    }
                },

                /**
                 * This is boiler plate to call quby.runtime.runCode for you using the
                 * code stored in this Result object and the onError function set.
                 */
                run: function() {
                    if ( ! this.hasErrors() ) {
                        quby.runtime.runCode( this.getCode(), this.onErrorFun );
                    }
                }
            };

            return Result;
        })()
    };

    /**
     * SourceLines deals with translations made to an original source code file.
     * It also deals with managing the conversions from an offset given from the
     * parser, to a line number in the original source code.
     */
    /*
     * In practice this works through two steps:
     *
     *  1) The source code is 'prepped' where certain changes are made. This
     * happens as soon as this is created and the result should be used by the
     * parser.
     *
     *  2) The source code is scanned and indexed. This is for converting
     * character offsets to line locations. This only occurres if a line number
     * has been requested, which in turn should only happen when there is an
     * error. This is to ensure it's never done unless needed.
     */
    var SourceLines = function (src) {
        // altered when indexed ...
        this.numLines = 0;
        this.lineOffsets = null;

        // source code altered and should be used for indexing
        this.source = src;

        Object.preventExtensions( this );
    };

    SourceLines.prototype = {
            index: function() {
                // index source code on the fly, only if needed
                if (this.lineOffsets == null) {
                    var src = this.source;

                    var len = src.length;
                    var lastIndex = 0;
                    var lines = [];
                    var running = true;

                    /*
                     * Look for 1 slash n, if it's found, we use it
                     * otherwise we use \r.
                     *
                     * This is so we can index any code, without having to alter it.
                     */
                    var searchIndex = (src.indexOf("\n", lastIndex) !== -1) ?
                            "\n" :
                            "\r" ;

                    while ( running ) {
                        var index = src.indexOf( searchIndex, lastIndex );

                        if (index != -1) {
                            lines.push(index);
                            lastIndex = index + 1;
                            // the last line
                        } else {
                            lines.push(len);
                            running = false;
                        }

                        this.numLines++;
                    }

                    this.lineOffsets = lines;
                }
            },

            getLine: function(offset) {
                this.index();

                for (var line = 0; line < this.lineOffsets.length; line++) {
                    // lineOffset is from the end of the line.
                    // If it's greater then offset, then we return that line.
                    // It's +1 to start lines from 1 rather then 0.
                    if (this.lineOffsets[line] > offset) {
                        return line + 1;
                    }
                }

                return this.numLines;
            },

            getSource: function () {
                return this.source;
            }
    };
})( quby, util );
