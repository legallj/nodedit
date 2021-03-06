/*jshint node:true, strict: false, browser: true, jquery: true, devel: true, camelcase: false */
/* jshint -W015 */
/* jshint -W117 */
/* jshint unused:false */
/* jshint shadow:true */
/* jshint bitwise:false */

//'use strict';

// NOTE: 'jshint' at https://github.com/gruntjs/grunt-contrib-jshint
// Octal literals are not allowed in strict mode, convert them to dec.
// Take '<workspace>/.jshintrc' into account then file options

/**
 * @fileOverview WebApp developped under node-webkit to edit, preview and execute files<br>
 * Version dated 2014-05-01 designed for Mac OS-X
 * @requires fs
 * @requires path
 * @requires child_process
 * @require marked
 * @requires nw-gui
 * @requires lastcontext.json
 */

/** @global */
/** {Module} Built in file system */
var fs = require('fs');

/** @global */
/** {Module} Built in file path utilities */
var path = require('path');

/** @global */
/** {Module} Built in process execution tools */
var childProcess = require('child_process');

/** @global */
/** {Module} External Markdown to HTML converter */
var marked = require('marked');

/** @global */
/** {Module} Node Webkit embedded GUI instance */
var gui = require('nw.gui');

/** @global */
/** {Module} Node mime type lookup functions */
var mime = require('mime');
// Set instead of mime default 'application/octet-stream'
mime.default_type = 'text/plain';

/** @global */
/** {Module} External code beautifier */
var beautify = require('js-beautify');

/** @global */
/** {String} Beautify language 'js', 'css', 'html'*/
var beautifyMode = null;

/** @global */
/** {Object} Code beautifier options */
var beautifyOptions = {
    'indent_size': 1,
    'indent_char': '\t',
    'indent_level': 0,
    'indent_with_tabs': true,
    'preserve_newlines': true,
    'max_preserve_newlines': 10,
    'jslint_happy': false,
    'brace_style': 'end-expand',
    'keep_array_indentation': false,
    'keep_function_indentation': false,
    'space_before_conditional': true,
    'break_chained_methods': false,
    'eval_code': false,
    'unescape_strings': true,
    'wrap_line_length': 0
};

/** @global */
/** {Module} Custom plugin: load snippet */
var snippet = require('snippet');

// -----------------------------
// GLOBAL VARIABLES
// -----------------------------
/** @global */
/** {Reference} to the CodeMirror text editor instance */
var editor;

/** @global */
/** {Reference} to every button elements in DOM */
var newButton, openButton, saveButton, runButton, viewButton;

/** @global */
/** {Reference} to drop-down menu */
var menu;

/** @global */
/** {String} Current file full path  */
var fileEntry = null;

/** @global */
/** {Boolean} Write access flag */
var hasWriteAccess;

/** @global */
/** {Reference} to the WebKit clip board (paste board) */
var clipboard = gui.Clipboard.get();

/** @global */
/** {Reference} to the '#output' div DOM element */
var outPage;

/** @global */
/** {Boolean} Current file was modified and must be saved */
var dirtyBit = false;

/** @global */
/** {Object} CodeMirror custom commands */
var extraKeys = {};

/** @global */
/** {String} Current editor mode 'javascript', 'shell', 'markdown' or 'plain/text'  */
var mode = '';

/** @global */
/** {Object} Remember CodeMirror context */
var lastContext = require('lastcontext.json');

/** @global */
/** {String} Run time interpreter to use */
var runTime = '';

/** @global */
/** {Reference} to secondary WebKit Chromium window */
var new_win = null;

/** @global */
/** {Integer} number of space per tab stop */
var tabWidth = 4;

/** @global */
/** {Array} List the ruler Objects to be displayed when mode is javascript */
var rulers = [];
for (var i = 1; i < 12; i++) {
	rulers.push({className: 'rulers', column: (tabWidth * i)});
}

// -----------------------------------------
// Catch the uncaught errors that weren't
// wrapped in a domain or try catch statement.
// Do not use this in modules, but only in
// applications, as otherwise we could have
// multiple of these bound.
// -----------------------------------------
process.on('uncaughtException', function (err) {
    // handle the error safely
    console.log('Uncaught error', err);
    //client.close();	// Conservative..!
});

/**
 * Helper to Create New document<br>
 * Introduced to avoid code duplication
 */
function helpCreateNewDoc() {
	// -------------------------
	//console.log("FUNCTION helpCreateNewDoc() called by:\n", arguments.callee.caller.toString());	// TRACE
	// -------------------------
	// Save global mode name
	mode = editor.getOption('mode');
	// Check if a valid snippet was selected
	if (fileEntry) {
		if (typeof mode === 'object') {
			// Special case of 'python' options
			mode = mode.name;
		}
		console.log('Snippet mode:', mode);	// DBG
		// Write content into '/tmp' folder
		writeEditorToFile(fileEntry);
		// Needed to set cursor at the expected position (!)
		editor.focus();
	}
}

// -----------------------------------------
// Create Editor menu
// -----------------------------------------

/** @global */
/** {Reference} to the WebKit Chromium window */
var win = gui.Window.get();

/** @global */
/** {Reference} to submenu of the WebKit tray-menu */
var subMenu = new gui.Menu();
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'Minimize',
	enabled: true,
	click: function () {
		win.minimize();
// Handled by 'minimize' window event in init
// this.enabled = false;
// subMenu.items[1].enabled = true;
	}
}));
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'Restore',
	enabled: false,
	click: function () {
		win.restore();
// Handled by 'restore' window event in init
// this.enabled = false;
// subMenu.items[0].enabled = true;
	}
}));
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'Recall Last',
	tooltip: 'Reload the last session and display document where it was leaved',
	enabled: true,
	click: function () {
		console.log('recall last context', lastContext.file);	// DBG
		if (!lastContext.file) {return; }	// Cancel
		setFile(lastContext.file, true);
		fs.readFile(lastContext.file, function (err, data) {
			if (err) {
				console.log('Read failed: ' + err);	// DBG
				return;
			}
			handleDocumentChange(lastContext.file);
			// Fill editor page
			editor.setValue(String(data));
			// Scroll to set the last cursor vertical position at center
			editor.scrollIntoView(lastContext.cursor, editor.getScrollInfo().clientHeight / 2);
			// Put cursor at its last recoded position
			editor.setCursor(lastContext.cursor);
			// Show the editor page as a clean document
			editor.focus();
			dirtyBit = false;
			$('#save').hide();
		});
	}
}));
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'Dev Tools',
	tooltip: 'Toggle debug window',
	click: function () {
		if (win.isDevToolsOpen()) {
			win.closeDevTools();
		}
		else {
			win.showDevTools();
		}
	}
}));
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'About',
	click: function () {
		// Open help page in a small separate
		// window with navigation bar
		var new_win = gui.Window.open('about.html', {
			position: 'center',
			toolbar: true,
			width: 800,
			height: 600
		});
		new_win.moveTo(150, 100);
	}
}));
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'Tutorial',
	click: function () {
		if (process.platform === 'darwin') {
			// Open tutorial page in the default browser window to get audio output
			childProcess.exec('open ' + process.cwd() + '/views/tuto.html', function (error, stdout, stderr) {
				if (error) {console.log(stderr.toString()); }
			});
		}
		else if (process.platform === 'linux') {
			// Open tutorial page in a browser window to get audio output
			childProcess.exec('/usr/bin/firefox ' + process.cwd() + '/views/tuto.html', function (error, stdout, stderr) {
				if (error) {console.log(stderr.toString()); }
			});
		}
		// Open a separate Chromium webkit window
		// video Ok but no audio output due to mp3 patent..!
// 		var new_win = gui.Window.open('tuto.html', {
// 			position: 'center',
// 			toolbar: true,
// 			width: 1350,
// 			height: 850
// 		});
// 		new_win.moveTo(150, 100);
	}
}));
subMenu.append(new gui.MenuItem({ type: 'separator' }));
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'Reload',
	click: function () {
		// Avoid tray duplication on reload
		if (tray) {
			tray.remove();
			tray = null;
		}
		win.reload();
	}
}));
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'Quit',
	tooltip: 'Close window and leave Application',
	click: function () {
		// Simple 'window.close()' statement
		// let the 'About' window opened..!
		// Then instead, first save context
		saveOnQuit();
		// And use 'gui.App' methods to leave
		// The 'quit()' method will not send close event
		// to windows and app will just quit quietly.
		gui.App.quit();
		//gui.App.closeAllWindows();
	}
}));
// TEST: USELESS
// https://github.com/rogerwang/node-webkit/issues/1507
// subMenu.append(new gui.MenuItem({
// 	type: 'normal',
// 	label: 'History Back',
// 	click: function () {
// 		window.history.back();
// 	}
// }));

/** @global */
/** {Reference} to tray icon with label */
var tray = null;

// -----------------------------------------
// Capture Cmd-Q to prevent OS-X kill process<br>
// The editor must have focus to respond.
// Under Mac OS-X standard clipboard commands
// are ignored then they shall be restored..!
// -----------------------------------------

/** @global */
/** {Object} Default editor keyboard shortcuts */
var defaultEditCmds = null;
if (process.platform === 'darwin') {
	defaultEditCmds = {
		// 'editor' not yet created, will be provided on demand as 'cm' argument
		'Cmd-C': function (cm) { clipboard.set(cm.getSelection()); },
		'Cmd-X': function (cm) { clipboard.set(cm.getSelection()); cm.replaceSelection(''); },
		'Cmd-V': function (cm) { cm.replaceSelection(clipboard.get()); },
		'Cmd-S': handleSaveCmd,
		'Cmd-O': handleOpenButton,
		'Cmd-N': handleNewButton,
		'Cmd-Q': function (cm) {
					saveOnQuit();
					gui.App.quit();
					//gui.App.closeAllWindows();
				},
		'Cmd-Alt-O': function (cm) {cm.toggleOverwrite(); },
		'Shift-Cmd-S': handleSaveButton,
		'Cmd-D': 'goPageDown',
		'Cmd-U': 'goPageUp',
		'Shift-Cmd-Space': 'autocomplete',
		'Ctrl-U': 'deleteLine',
		'Ctrl-T': 'toggleComment',
		'Enter': 'newlineAndIndentContinueComment'
	};
}
else if (process.platform === 'linux') {
	defaultEditCmds = {
		'Ctrl-C': function (cm) { clipboard.set(editor.getSelection()); },
		'Ctrl-X': function (cm) { clipboard.set(editor.getSelection()); editor.replaceSelection(''); },
		'Ctrl-V': function (cm) { editor.replaceSelection(clipboard.get()); },
		'Ctrl-S': handleSaveCmd,
		'Ctrl-O': handleOpenButton,
		'Ctrl-N': handleNewButton,
		'Ctrl-Q': function (cm) {
				saveOnQuit();
				gui.App.quit();
				//gui.App.closeAllWindows();
			},
		'Shift-Ctrl-S': handleSaveButton,
		'Ctrl-Alt-O': function (cm) {cm.toggleOverwrite(); },
		'Ctrl-D': 'goPageDown',
		'Ctrl-U': 'goPageUp',
		'Ctrl-Space': 'autocomplete',
		'Shift-Ctrl-U': 'deleteLine',
		'Ctrl-T': 'toggleComment',
		'Enter': 'newlineAndIndentContinueComment'
	};
}

// -----------------------------------------
// Note: The editor must have focus to respond
// -----------------------------------------

/** @global */
/** {Object} Markdown specific keyboard shortcuts */
var markdownEditCmds = {
	'Cmd-B': function (doc) { /* Bold */
		if (doc.somethingSelected()) {
			var string = doc.getSelection();
			doc.replaceSelection('**' + string + '**');
		}
	},
	'Cmd-I': function (doc) { /* Italic */
		if (doc.somethingSelected()) {
			doc.replaceSelection('*' + doc.getSelection() + '*');
		}
	},
	'Cmd-U': function (doc) { /* Underline (Haroopad only) */
		if (doc.somethingSelected()) {
			// Underscore surrounded text is only recognized by 'Haroopad' as underline
			//doc.replaceSelection('_' + doc.getSelection() + '_');
			doc.replaceSelection('<span style="text-decoration:underline;">' + doc.getSelection() + '</span>');
		}
	},
	'Cmd-J': function (doc) { /* Code */
		if (doc.somethingSelected()) {
			doc.replaceSelection('`' + doc.getSelection() + '`');
		}
	},
	'Cmd-Alt-J': function (doc) { /* Cite block of lines */
		if (!doc.somethingSelected()) {return; }
		var begin = doc.getCursor('start');
		var end = doc.getCursor('end');
		for (var ln = begin.line; ln < end.line; ln++) {
			doc.setCursor({line: ln, ch: 0});
			doc.replaceSelection('> ');
		}
		doc.setCursor(end);
	},
	'Cmd-K': function (doc) { /* Web Link */
		if (!doc.somethingSelected()) {return; }
		doc.replaceSelection('[' + doc.getSelection() + ']( \'\')');
		var pos = doc.getCursor();
		pos.ch -= 4;
		doc.setCursor(pos);
	},
	'Cmd-L': function (doc) { /* Bullet List */
		if (!doc.somethingSelected()) {return; }
		var begin = doc.getCursor('start');
		var end = doc.getCursor('end');
		for (var ln = begin.line; ln < end.line; ln++) {
			doc.setCursor({line: ln, ch: 0});
			doc.replaceSelection('- ');
		}
		doc.setCursor(end);
	},
	'Cmd-Alt-L': function (doc) { /* Numbered List */
		if (!doc.somethingSelected()) {return; }
		var begin = doc.getCursor('start');
		var end = doc.getCursor('end');
		var count = 1;
		// Check list continuation
		var prev_line = doc.getLine(begin.line - 1);
		if  (prev_line) {
			var prev_num = prev_line.match(/^(\d+)\.\s/);
			count = prev_num ? (parseInt(prev_num[1], 10) + 1):1;
		}
		// Insert numbering
		for (var ln = begin.line; ln < end.line; ln++) {
			doc.setCursor({line: ln, ch: 0});
			doc.replaceSelection(count + '. ');
			count++;
		}
		doc.setCursor(end);
	}
};

// -----------------------------
// NOTE:
// RegExp tester at http://regex101.com/
// -----------------------------

/**
 * Configure the editor according to doc-type<br>
 * @param {String} filePath - Full path of the target file
 */
function handleDocumentChange(filePath) {
	// --------- Notes ---------
	// http://stackoverflow.com/questions/280389/how-do-you-find-out-the-caller-function-in-javascript
	// But this name will be the one after the 'function' keyword (no name for handlers)
	//console.log("handleDocumentChange called by:", arguments.callee.caller.name);	// TRACE
	// Then show the code of the caller function
	// -------------------------
	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/caller
	// The obsolete 'arguments.caller' property is replaced by '<myFuncName>.caller'
	// -------------------------
	//console.log("FUNCTION handleDocumentChange(", filePath, ") called by:\n", arguments.callee.caller.toString());	// TRACE
	// -------------------------
	$('#run').hide();
	$('#view').hide();
	// Default 'js' edit parameters
	mode = 'text/plain';
	var modeName = 'Plain text';
	runTime = '';
	var lint = false;
	var theme = 'default';
	if (filePath) {
		// https://www.npmjs.org/package/mime
		// Not yet used..!
		var mimeType = mime.lookup(filePath);
		console.log('filePath/mime:', filePath, mimeType);	// DBG
		// Hide output page if displayed
		outPage.hide();
		// Display file full path in window title bar
		//document.getElementsByTagName('title')[0].textContent = filePath;
		document.title = filePath;
		// Get file name without its leading path (basename)
		var title = path.basename(filePath);
		document.getElementById('title').innerHTML = title;
		//document.title = title;	// Replaced by file full path
		var ext = path.extname(filePath);
		var dir = path.dirname(filePath);
		extraKeys = defaultEditCmds;
		menu.items[5].enabled = false;
		lint = false;
		// No tab rulers by default
		editor.setOption('rulers', null);
		// Auto-pair braces and quotes by default
		editor.setOption('autoCloseBrackets', true);
		// Disable code beautifier
		beautifyMode = null;
		// Test file extension (including leading dot)
		switch (ext) {
		case '.js':
			mode = 'javascript';
			modeName = 'JavaScript';
			theme = 'vibrant-ink';
			runTime = '/usr/bin/env node';
			extItem.submenu = submenuJavascript;
			menu.items[5].enabled = true;
			lint = true;
			editor.setOption('rulers', rulers);
			beautifyMode = 'js';
			$('#run').show();
			break;
		case '.json':
			mode = {name: 'javascript', json: true};
			modeName = 'JavaScript (JSON)';
			theme = 'vibrant-ink';
			editor.setOption('rulers', rulers);
			break;
		case '.html':
			mode = 'htmlmixed';
			modeName = 'HTML';
			lint = false;
			//theme = 'monokai';
			theme = 'vibrant-ink';
			editor.setOption('autoCloseTags', true);
			// Define Emmet output profile
			editor.setOption('profile', 'xhtml');
			beautifyMode = 'html';
			extItem.submenu = submenuHTML;
			menu.items[5].enabled = true;
			$('#view').show();
			break;
		case '.css':
			mode = 'css';
			modeName = 'CSS';
			theme = 'monokai';
			beautifyMode = 'css';
			extItem.submenu = submenuCSS;
			menu.items[5].enabled = true;
			break;
		case '.scss':
			mode = 'css';
			modeName = 'SCSS';
			theme = 'monokai';
			break;
		case '.md':
		case '.mkd':
		case '.mmd':
		case '.markdown':
			mode = 'markdown';
			modeName = 'Markdown';
			theme = 'solarized light';
			// Use jQuery function to extend the keyMap
			// -------------
			// NOTE: Keep in mind that the target object (first argument)
			// will be modified, and will also be returned from $.extend().
			// If, however, you want to preserve both of the original
			// objects, you can do so by passing an empty object as the target.
			// -------------
			extraKeys = $.extend({}, defaultEditCmds, markdownEditCmds);
			// Auto-pair braces and quotes is useless for Markdown text
			editor.setOption('autoCloseBrackets', false);
			extItem.submenu = submenuMarkdown;
			menu.items[5].enabled = true;
			$('#view').show();
			break;
		case '.sh':
		case '.command':
			mode = 'shell';
			modeName = 'Shell';
			theme = 'vibrant-ink';
			runTime = '/usr/bin/env bash ';
			$('#run').show();
			break;
		case '.py':
			mode = {name: 'python',
					version: 2,
					singleLineStringErrors: false};
			modeName = 'Python-2';
			theme = 'vibrant-ink';
			runTime = '/usr/bin/env python ';
			editor.setOption('rulers', rulers);
			$('#run').show();
			break;
		case '.c':
			// WARNING
			// 'clike' is not a recognized mode..!
			mode = 'text/x-c';
			modeName = 'C';
			theme = 'vibrant-ink';
			editor.setOption('rulers', rulers);
			var fileExec = path.join(dir, path.basename(filePath, ext)); // Remove extension
			runTime = 'gcc --std=c99 -Wall -o ' + fileExec + ' ' + filePath + ' && ' + fileExec;
			console.log('Run fileExec:', fileExec);
			$('#run').show();
			break;
		case '.cpp':
			mode = 'text/x-c++src';
			modeName = 'CPP';
			theme = 'vibrant-ink';
			editor.setOption('rulers', rulers);
			var fileExec = path.join(dir, path.basename(filePath, ext)); // Remove extension
			runTime = 'g++ -Wall -o ' + fileExec + ' ' + filePath + ' && ' + fileExec;
			console.log('Run fileExec:', fileExec);
			$('#run').show();
			break;
		case '.java':
			// WARNING
			// 'clike' is not a recognized mode..!
			mode = 'text/x-java';
			modeName = 'Java';
			theme = 'vibrant-ink';
			editor.setOption('rulers', rulers);
			var fileClass = path.basename(filePath, ext);
			runTime = 'javac ' + filePath + ' && java -cp ' + dir + ' ' + fileClass;
			console.log('Run fileClass:', runTime);
			$('#run').show();
			break;
		default :
			mode = 'text/plain';
			modeName = 'Plain text';
			theme = 'default';
			// Auto-pair braces and quotes is useless for text entry
			editor.setOption('autoCloseBrackets', false); // Useless for text entry
			editor.setSelection({line: 0, ch: 0}, {line: 1, ch: 0});	// Select line to be replaced
			$('view').hide();
		} // end switch on extension
	}
	else {
		console.log('No file, edit a new document');	// DBG
		document.getElementById('title').innerHTML = '[no document loaded]';
		mode = 'text/plain';
		modeName = 'Plain text';
		theme = 'default';
		lint = false;
		editor.setOption('rulers', null);
	} // end if
	console.log('Found doc type:', mode);	// DBG
	extItem.label = modeName;
	editor.setOption('mode', mode);
	editor.setOption('lint', lint);
	editor.setOption('theme', theme);
	editor.setOption('extraKeys', extraKeys);
	document.getElementById('mode').innerHTML = modeName;
	// New clean document
	dirtyBit = false;
	$('#save').hide();
} // end handleDocumentChange

// -----------------------------
// Execute commands
// -----------------------------

/**
 * Execute new file command<br>
 * Called by: handleNewButton(), onload event handler<br>
 * Make call: handleDocumentChange()
 */
function newFile() {
	console.log('Open new file');	// DBG
	fileEntry = null;
	hasWriteAccess = true;
	handleDocumentChange('');
}
/**
 * Helper: set var fileEntry, hasWriteAccess<br>
 * Called by: onChosenFileToOpen, onChosenFileToSave event handlers<br>
 * Make call: none
 */
function setFile(theFileEntry, isWritable) {
	fileEntry = theFileEntry;
	hasWriteAccess = isWritable;
	console.log('setFile:', fileEntry);	// DBG
}
/**
 * Read file content and fill the editor<br>
 * Called by: readFileIntoEditor event handler<br>
 * Make call: handleDocumentChange()<br>
 * @param {String} theFileEntry - Full path of the current file
 */
function readFileIntoEditor(theFileEntry) {
	// Check if some selection was made
	if (!theFileEntry) {return; }
	fs.readFile(theFileEntry, function (err, data) {
		if (err) {
			console.log('Read failed: ' + err);	// DBG
		}
		handleDocumentChange(theFileEntry);
		// Fill editor page
		editor.setValue(String(data));
		editor.setCursor({line: 0, ch: 0});
		editor.focus();
		dirtyBit = false;
		$('#save').hide();
	});
}

/**
 * Convert SCSS file to CSS with host command sassc<br>
 * Available under OS-X only..!<br>
 * Called by: writeEditorToFile()
 * @param {String} theFileEntry - Full path of the current scss file<br>
 */
 function convertToCss(f) {
	var cssPath = path.join(path.dirname(f), path.basename(f, '.scss') + '.css');
	console.log('CSS output in', cssPath);	// DBG
	// Sassc option '-t' (--style) can only be 'nested' (more readable) or 'compressed'
	// Default import path option '-I' is set to './'
	var child = childProcess.exec('/usr/local/bin/sassc -t compressed ' + f + ' ' + cssPath, function (error, stdout, stderr) {
		//console.log('CSS output in', cssPath);
		if (error !== null) {
			// NOTE: In case of error, no css file is produced (?)
			alert(error.message);
		}
// DELETED: Already done by handleSaveCmd()
// 		else if (new_win) {
// 			// Success then refresh HTML display with new css style
// 			new_win.reloadIgnoringCache();
// 		}
	});
}

/**
 * Write editor text content into file and adjust UNIX 'rwx' mode<br>
 * Called by: onChosenFileToSave event handler, handleSaveButton(), handleSaveCmd()<br>
 * Make call: handleDocumentChange() convertToCss()<br>
 * @param {String} theFileEntry - Full path of the current file<br>
 * @returns {Object} null or write error object
 */
function writeEditorToFile(theFileEntry) {
	// -------------------------
	//console.log("FUNCTION writeEditorToFile(", theFileEntry, ") called by:\n", arguments.callee.caller.toString());	// TRACE
	// -------------------------
	fs.writeFile(theFileEntry, editor.getValue(), function (err) {
		if (err) {
			console.log('Write failed: ' + err);	// DBG
			return err;
		}
		// Set execution rights according to document type
		// Note: Octal constants are not allowed by JSHint
		// Octal '0777' (511) or '0666' (438) means 'rwx' or 'rw-' file mode
		var xxx = ((mode === 'javascript') || (mode === 'shell') || (mode === 'python')) ? 511:438;
		fs.chmod(theFileEntry, xxx, function (err) {
			handleDocumentChange(theFileEntry);
			console.log('File:', mode, 'Write completed with mode:', xxx);	// DBG
			if (path.extname(fileEntry) === '.scss') {
				convertToCss(fileEntry);
			}
			return err;
		}); // end fs.chmod()
	}); // end writeFile()
}

// -----------------------------
// File chooser event handlers
// -----------------------------

// ----------- REMOTE ----------
// For security reason remote file editing
// relies on local host 'scp' command assuming the
// correct public key is available on the remote host:
// - Copy local ~/.ssh/id_rsa.pub
// - Into remote ~/.ssh/authorized_keys
// Refer to http://doc.ubuntu-fr.org/ssh
// ----------- USAGE -----------
// To edit a remote file, create a JSON
// descriptor formatted as below:
// {
// 	"file": "/home/legallj/test.txt", <--(remote path)
// 	"user": "legallj",
// 	"host": "neptune",
// 	"port": 22, <--(optional)
// 	"path": "/tmp/test.txt" <--(local path)
// }
// Then mame this descriptor '<whatever>.scp'
// and use it from nodEdit as if it was a local file.
// The free extension '.scp' makes the difference..!
// ----------- NOTES -----------
// Refer to file extensions list at:
// http://fr.wikipedia.org/wiki/Liste_d%27extensions_de_fichiers#S
// -----------------------------
// Refer to node-webkit specific input file attributes
// https://github.com/rogerwang/node-webkit/wiki/File-dialogs
// -----------------------------

/**
 * Open file chooser event handlers<br>
 * Called by: readFileIntoEditor event handler<br>
 * Make call: setFile(), readFileIntoEditor()<br>
 * @param {String} theFileEntry - Full path of the current file
 */
var onChosenFileToOpen = function (theFileEntry) {
	console.log('Call: onChosenFileToOpen', theFileEntry);	// DBG
	if (!theFileEntry) {return; }	// Cancel
	// Set default open and save file path to the last value as per:
	// https://github.com/rogerwang/node-webkit/wiki/File-dialogs
	// (But seems to be automatic.!?)
	$('#openFile').attr('nwworkingdir', path.dirname(theFileEntry));
	// You can specify a value for the default file name to save.
	// Unless specified, we save file in place:
	$('#saveFile').attr('nwsaveas', theFileEntry);
	// -------------------------
	// If extension is '*.scp' then a remote file
	// have to be downloaded into local 'path' via scp
	// -------------------------
	if (path.extname(theFileEntry) === '.scp') {
		console.log('Download request');	// DBG
		download(theFileEntry);
	}
	else {
		setFile(theFileEntry, false);
		readFileIntoEditor(theFileEntry);
	}
};

/**
 * Helper: Execute 'scp' download file command
 * Called by: onChosenFileToOpen handler
 * Make call: childProcess.exec()
 * @param {String} remoteFileDescriptor - Full path of the current '*.scp' file locator
 */
function download(remoteFileDescriptor) {
	// WARN: readFileSync returns a 'buffer' unless an encoding option is specified
	var remote = JSON.parse(fs.readFileSync(remoteFileDescriptor, {encoding: 'utf8', flag: 'r'}));
	console.log('Remote file Object:', remote);	// DBG
	// Build the command line
	var scpCommand = [
		'scp',
		'-P',
		(remote.port === undefined ? '22' : remote.port),
		(remote.user + '@' + remote.host + ':' + remote.file),
		remote.path
	];
	console.log('Command:', scpCommand.join(' '));	// DBG
	// Execution parameters
	var scpOptions = {
		encoding: 'utf8',
		timeout: 2500,
		maxBuffer: 200 * 1024,
		killSignal: 'SIGTERM',
		cwd: null,
		env: null };
	// Run local host 'scp' command in a Shell
	var child = childProcess.exec(scpCommand.join(' '), scpOptions, function (err, stdout, stderr) {
		console.log('Child PID:', child.pid, '\nstdout:', stdout);
		if (err) {
			alert('Download:\n' + err.message);
			console.log('stderr:', stderr);
		}
		else {
			console.log('File downloaded into:', remote.path);
			setFile(remote.path, false);		// Set global var 'fileEntry' to local path
			readFileIntoEditor(remote.path);	// Display file content
		}
	});
// -------- ALTERNATIVE --------
//	Spawn 'scp' works without Shell but the built-in timeout is very long..!
// 	var child = childProcess.spawn('scp', scpCommand);
// 	child.on('close', function (code) {
// 		console.log('Child process exited with code ' + code);
// 	});
// -----------------------------
}

/**
 * Save file chooser event handlers<br>
 * Called by: save file event handler<br>
 * Make call: setFile(), writeEditorToFile()<br>
 * @param {String} theFileEntry - Full path of the current file
 */
var onChosenFileToSave = function (theFileEntry) {
	if (!theFileEntry) {return; }	// Cancel
	// -------------------------
	// If extension is '*.scp' then the current path
	// have to be uploaded to remote 'file' via scp
	// -------------------------
	if (path.extname(theFileEntry) === '.scp') {
		console.log('Upload request');	// DBG
		upload(theFileEntry);
	}
	else {
		setFile(theFileEntry, true);
		writeEditorToFile(theFileEntry);
	}
};

/**
 * Helper: Execute 'scp' upload file command
 * Called by: onChosenFileToSave handler
 * Make call: childProcess.exec()
 * @param {String} remoteFileDescriptor - Full path of the current '*.scp' file locator
 */
function upload(remoteFileDescriptor) {
	var remote = JSON.parse(fs.readFileSync(remoteFileDescriptor, {encoding: 'utf8', flag: 'r'}));
	console.log('Remote file Object:', remote);	// DBG
	// Save editor content into local file
	writeEditorToFile(remote.path);
	// Build the command line
	var scpCommand = ['scp',
		'-P', (remote.port === undefined ? '22' : remote.port),
		remote.path,
		(remote.user + '@' + remote.host + ':' + remote.file)
	];
	console.log('Command:', scpCommand.join(' '));	// DBG
	// Execution parameters
	var scpOptions = {
		encoding: 'utf8',
		timeout: 2500,
		maxBuffer: 200 * 1024,
		killSignal: 'SIGTERM',
		cwd: null,
		env: null };
	// Run local host 'scp' command
	var child = childProcess.exec(scpCommand.join(' '), scpOptions, function (err, stdout, stderr) {
		if (err) {
			alert('Upload:\n' + err.message);
			console.log('stderr:', stderr);
		}
		console.log('File uploaded from:', remote.path, 'into', remote.file);
	});
}

// -----------------------------
// Command Handlers
// -----------------------------

/**
 * New file button event handlers<br>
 * Called by: newButton.addEventListener()<br>
 * Make call: editor.setValue()<br>
 */
function handleNewButton() {
	if (true) {
		newFile();
		editor.setValue('New plain text file...');
		editor.setCursor({line: 0, ch: 0});
		editor.setSelection({line: 0, ch: 0}, {line: 1, ch: 0});	// Select line
		editor.focus();
		dirtyBit = true;
		$('#save').show();
		outPage.hide();
	}
	else {
		// DISABLED
		//Open a separate window
		var x = window.screenX + 10;
		var y = window.screenY + 10;
		window.open('main.html', '_blank', 'screenX=' + x + ',screenY=' + y);
	}
}

/**
 * Open file button event handlers<br>
 * Called by: openButton.addEventListener()<br>
 * Mae call: onChosenFileToOpen()
 */
function handleOpenButton() {
	$('#openFile').trigger('click');
}

/**
 * Save file button event handlers<br>
 * Called by: saveButton.addEventListener()<br>
 * Make call: onChosenFileToSave()
 */
function handleSaveButton() {
	if (false) {
		writeEditorToFile(fileEntry);
	}
	else {
		$('#saveFile').trigger('click');
	}
}

/**
 * Run file button event handlers,<br>
 * - Save file before run<br>
 * - Prompt user for arguents<br>
 * Called by: runButton.addEventListener()<br>
 * Make call: doRunFile()<br>
 */
function handleRunButton() {
	if (outPage.is(':visible')) {
		// Return to editor page
		outPage.hide();
		editor.focus();
		$('#run').text('RUN');
		return;
	}
	if (dirtyBit) {
		// Save content before run
		fs.writeFileSync(fileEntry, editor.getValue());
		dirtyBit = false;
		$('#save').hide();
	}
	console.log('Run handler on file', fileEntry);	// DBG
	// Get and check user's arguments
	// Replace the ugly 'prompt' modal window
	// Use instead the built in dialog extension
	// closed by ESC (cancel) or ENTER (validate)
	editor.openDialog('<input type="text" value="default">Execution args</input>', doRunFile);
}

/**
 * Run file<br>
 * Try to execute Node or Shell file providing
 * they are executable as a child process<br>
 * Called by: handleRunButton() dialog callback<br>
 */
function doRunFile(argStr) {
	//var argStr = prompt('Execution arguments');
	var args;
	if (argStr === null) {
		return;	// Cancel execution
	}
	else if (argStr === '') {
		args = null;	// No exec arguments
	}
	else {
		args = argStr.split(' ');	// Array of words
	}
	console.log('Arguments:', args);	// DBG
	// Clear output page (console like)
	outPage.empty();
	// Check if a run time interpreter
	// is specified with a shebang in first line
	// ---------------------------------
	// Use childProcess.exec with the right run time call
	// http://nodejs.org/api/child_process.html#child_process_child_process_exec_command_options_callback
	// Create a command like:
	// var child = childProcess.exec('/usr/bin/env node ./test.js tagada', function (error, stdout, stderr) {console.log(stdout); });
	// ---------------------------------
	var firstLine = editor.getLine(0);
	if (! /^#!/.test(firstLine)) {
		outPage.append($('<pre />').text('Run time interpreter declaration not found in first line:\n' + firstLine + '\nThen try to use:\n' + runTime).css('color', 'red'));
		// Build the command line to execute
		var cmdList = [runTime];
		cmdList.push(fileEntry);
		cmdList = cmdList.concat(args);
		childProcess.exec(cmdList.join(' '), function (error, stdout, stderr) {
			if (error !== null) {
				console.log('exec error: ' + error);
				$('<pre />').text(stderr.toString()).css('color', 'red').appendTo(outPage);
			}
			outPage.append('<pre>' + stdout.toString() + '</pre>');
		});
	}
	else {
		fs.stat(fileEntry, function (err, stats) {
			//console.log('stats:', stats);	// DBG
			// Octal constant 0111 to check if file mode is '??x' i.e. executable
			var xxx = stats.mode & 73;
			if (stats.isFile() && xxx === 73) {
				console.log('File executable by', process.env.USER);	// DBG Info
				childProcess.execFile(fileEntry, args, null, function (error, stdout, stderr) {
					if (error !== null) {
						console.log('execFile error: ' + error);
						$('<pre />').text(stderr.toString()).css('color', 'red').appendTo(outPage);
					}
					outPage.append('<pre>' + stdout.toString() + '</pre>');
				});
			}
			else {
				outPage.html($('<pre />').text('Execute file:\n' + fileEntry + '\nPermission denied..!').css('color', 'red'));
			}
		});
	}
	outPage.show();
	$('#run').text('EDIT');
}

// --------- Buttons -----------
// is(selector) not supported by Zepto
// for non-standard pseudo-selectors
// such as ':visible'. Then use flag
// or include jQuery instead of Zepto
// -----------------------------

/**
 * Preview HTML and Markdown file button click event handlers<br>
 * Called by: viewButton.addEventListener()<br>
 */
function handleViewButton() {
	console.log('View handler');
	if (outPage.is(':visible')) {
		// The 'output' page is displayed
		// then switch to 'editor' page
		console.log('Hide output');
		outPage.hide();
		$('#view').text('VIEW');
		return;
	}
	console.log('Show output:', mode);
	// Take actual 'mode' into account
	// Provisional switch-case for future modes
	switch (mode) {
	case 'htmlmixed':
		if (!new_win) {
			// Open a separate window
			// with navigation bar
			new_win = gui.Window.open('file://' + fileEntry, {
				position: 'center',
				toolbar: true,
				width: 800,
				height: 600
			});
			// Put window aside
			new_win.moveTo(150, 100);
			/**
			* Register close event to remove reference
			* TODO Fix bug when new_win is closed by hand
			*/
			new_win.on('closed', function () {
				new_win = null;
				console.log('new_win closed');	// DBG
			});
			new_win.on('close', function () {
				this.hide();
				this.close(true);
				new_win = null;
				console.log('Close new_win');	// DBG
				$('#view').show();
			});
			// Hide 'View' button, now rely on
			// 'Save' button to refresh window
			$('#view').hide();
		}
		else {
			// Refresh window display
			// (new content assumed)
			new_win.reloadIgnoringCache();
		}
		break;
	case 'markdown':
		// Render Markdown into 'output' page
		// the editor content as Markdown
		outPage.html(marked(editor.getValue()));
		/**
		* Highlight code blocks
		*/
		$('#output pre code').each(function (i, el) {
			hljs.highlightBlock(el);
		});
		/**
		* Register Web links
		*/
		$('#output a').each(function (i, el) {
			$(this).click(function (ev) {
				ev.preventDefault();
				var href = $(this).attr('href');
				//console.log('href:', href);	// DBG
				// Open Web page in a small separate
				// browser window with its navigation bar
				var new_win = gui.Window.open(href, {
					position: 'center',
					toolbar: true,
					width: 800,
					height: 600
				});
				new_win.moveTo(150, 100);
			});
		});
		outPage.show();
		$('#view').text('EDIT');
		break;
	default:
		// Nothing to display
		$.noop();
	} // end switch case
} // end handleViewButton()

/**
 * Save file on keyboard command 'Cmd-S'<br>
 * Called by: defaultEditCmds entry<br>
 */
function handleSaveCmd() {
	console.log('Save file:', fileEntry);	// DBG
	if (!fileEntry) {return; }	// No file name, use 'Save As' instead
	var err = writeEditorToFile(fileEntry);
	console.log('File saved', (err ? 'ERROR':'Ok'));
	dirtyBit = false;
	$('#save').hide();
	if (new_win) {
		// Refresh display with new content after 500ms
		setTimeout(function () {
			new_win.reloadIgnoringCache();
		}, 500);
		$('#view').hide();
	}
}

// ------ Line numbers from text -------
// Refer to JavaScript W3 school:
// http://www.w3schools.com/jsref/jsref_obj_global.asp
// http://www.hacksparrow.com/node-js-exports-vs-module-exports.html
// Regex online tester:
// http://regex101.com/
// -------------------------------------

/**
 * Scan document to list 'Functions'<br>
 * Record line number where to jump<br>
 * Relies on correct usage of DocStrings<br>
 * Called by: Popup context menu label 'List Funcs'<br>
 * @param {Object} editor - CodeMirror instance
 * @returns {String} html - Formated HTML table
 */
function listFuncs(editor) {
	// TEST scan editor with:
	//   editor.lineCount()
	//   editor.lineInfo(line) --> {line, handle, text, markerText, markerClass, lineClass, bgClass}
	// Benchmark result:
	//   Slower than direct method, then discarded
	// Online 'regex' tester at:
	//   http://regex101.com/

	// Record current line number to later return on it
	var curLine = editor.getCursor().line + 1;
	//var deb = new Date();	// Benchmark
	// Make an array of lines with editor content
	var lines = editor.getValue().split('\n');
	var result = [];

	// Compile RegExp only once
	// Check online at http://regex101.com/
	var funcPatt = /^\s*function\s+(\w+)/;
	funcPatt.compile(funcPatt);
	var handlePatt = /(\w+)\s+=\s+function/;
	handlePatt.compile(handlePatt);
	var callbackPatt = /(\w+)\(.*?function/;
	callbackPatt.compile(callbackPatt);
	var cmtoutPatt = /^[\s\t]*(\/\/|\/\*|\*)/;
	cmtoutPatt.compile(cmtoutPatt);

	// Scan lines in array (10x faster than 'for in')
	//console.log('listFuncs nb lines:', lines.length);
	var count = 0;
	for (var lnum = 0; lnum < lines.length; lnum++) {
		// Skip empty lines
		if (lines[lnum].length === 0) {
			continue;
		}
		// Skip comment lines
		if (cmtoutPatt.test(lines[lnum])) {
			continue;
		}
		var mf = lines[lnum].match(funcPatt);
		var mh = lines[lnum].match(handlePatt);
		var mc = lines[lnum].match(callbackPatt);
		// This method returns 'null' if no match is found.
		if (mf || mh || mc) {
			var cmt = [];
			var mcmt = null;
			// Search JSDoc comment in the 10 lines above declaration
			for (var before = 1; before < 12; before++) {
				if (lines[lnum - before].indexOf('/**') !== -1) {
					// Optimization:
					// Stop scan as soon as the leading doc-string is found
					break;
				}
				mcmt = lines[lnum - before].match(/\*\s+(.+)$/);
				if (mcmt) {
					cmt.unshift(mcmt[1]);
				}
			} // end for
			if (mh) {
				// Handler function
				result.push('<span class="lnum">' + (lnum + 1) + '</span></td><td><em>' + mh[1] + '</em></td><td><em>on Event</em></td><td>' + cmt.join(' '));
				//editor.setMarker(lnum, '%N%');	// Seems not implemented in CodeMirror-3..!
			}
			else if (mf) {
				// Callable function
				result.push('<span class="lnum">' + (lnum + 1) + '</span></td><td>' + mf[1] + '</td><td>on Call</td><td>' + cmt.join(' '));
			}
			else if (mc) {
				// Callback function
				result.push('<span class="lnum">' + (lnum + 1) + '</span></td><td>' + mc[1] + '</td><td>Callback</td><td>' + cmt.join(' '));
			}
			count++;
		}
	} // end for
	console.log('listFuncs last line:', lnum, lines.length);
	var head = '<h1>Functions definition</h1>\n<table><tbody>\n<tr><th>Line</th><th>Name</th><th>Execute</th><th>JSDoc Description</th></tr>\n<tr><td>';
	var tail = '</td></tr>\n</tbody>\n<caption><em>&mdash;&nbsp;Found ' + count + ' functions&nbsp;&mdash;</em></caption></table>\n<p><strong>Back to editor at line [<span class="lnum">' + curLine + '</span>]</strong></p>';
	var html = head + result.join('</td></tr>\n<tr><td>') + tail;
	//var end = new Date();	// Benchmark
	//console.log(end.getTime() - deb.getTime(), 'ms');	// Benchmark
	return html;
} // end listFuncs()

/**
 * Scan document to list 'Variables'<br>
 * Record line number where to jump<br>
 * Relies on correct usage of DocStrings<br>
 * Called by: Popup context menu label 'List Vars'<br>
 * @param {Object} editor - CodeMirror instance
 * @returns {String} html - Formated HTML table
 */
function listVars(editor) {
	// Record current line number to later return on it
	var curLine = editor.getCursor().line + 1;
	// Make an array of lines with editor content
	var lines = editor.getValue().split('\n');
	var result = [];
	// Compile RegExp only once
	var varPatt = /^var\s+(\w+)/;
	varPatt.compile(varPatt);
	var typePatt = /\/\*\*\s+(.+)\*\//;
	typePatt.compile(typePatt);
	// Scan lines in array (10x faster than 'for in')
	var count = 0;
	for (var lnum = 0; lnum < lines.length; lnum++) {
		// Skip empty lines
		if (lines[lnum].length === 0) {
			continue;
		}
		var mv = lines[lnum].match(varPatt);
		var isFn = (lines[lnum].indexOf('function') > -1) ? '{Handler} Refer to list of functions...':'???';
		if (mv) {
			//console.log('var', mv[1]);	// DBG
			var mt = lines[lnum - 1] ? lines[lnum - 1].match(typePatt) : null;
			result.push('<span class="lnum">' + (lnum + 1) + '</span></td><td>' + mv[1] + '</td><td>' + (mt ? mt[1]:isFn));
			count++;
		}
	} // end for
	var head = '<h1>Global Variables</h1>\n<table><tbody>\n<tr><th>Line</th><th>Name</th><th>Type</th></tr>\n<tr><td>';
	var tail = '</td></tr>\n</tbody>\n<caption><em>&mdash;&nbsp;Found ' + count + ' variables&nbsp;&mdash;</em></caption></table>\n<p><strong>Back to editor at line [<span class="lnum">' + curLine + '</span>]</strong></p>';
	var html = head + result.join('</td></tr>\n<tr><td>') + tail;
	return html;
} // end Vars()

/**
 * Jump to a given line number<br>
 * Stay inside editor bounds and center display
 */
function gotoLine() {
	editor.openDialog('<input type="text" value="default">Line number</input>',
		function (str) {
			var numLine = parseInt(str, 10);
			//console.log('Line:', str, numLine, isNaN(numLine));	// DBG
			if (isNaN(numLine)) {return; }	// Not a Number
			if (numLine > editor.lineCount()) {numLine = editor.lineCount(); } // Above range
			if (numLine < 1) {numLine = 1; } // Under range
			numLine--;	// Get zero based index
			editor.scrollIntoView(numLine, editor.getScrollInfo().clientHeight / 2);
			// Put cursor at beginning of target line
			editor.setCursor({line: numLine, ch: 0});
		}
	);
}

/**
 * Beautify selected code according to language<br>
 * defined by 'beautifyMode' among js, html or css
 */
function beautifyCode() {
	if (!editor.somethingSelected()) {return; }
	var data = editor.getSelection();
	editor.replaceSelection(beautify[beautifyMode](data, beautifyOptions));
}
// -----------------------------
// Popup Javascript subMenu
// -----------------------------

/** @global */
/** {Instance} Create Javascript dedicated popup sub-menu */
var submenuJavascript = new gui.Menu();
submenuJavascript.append(new gui.MenuItem({
	label: 'List Funcs',
	click: function () {
		$('#output').html(listFuncs(editor));
		$('#output').show();
		$('.lnum').click(function () {
			var numLine = $(this).text() - 1;
			//console.log('lnum:', numLine);	// DBG
			$('#output').hide();
			editor.scrollIntoView(numLine, editor.getScrollInfo().clientHeight / 2);
			// Put cursor at beginning of function
			editor.setCursor({line: numLine, ch: 0});
			// Show the editor page
			editor.focus();
		});
	}
}));
submenuJavascript.append(new gui.MenuItem({
	label: 'List Vars',
	click: function () {
		$('#output').html(listVars(editor));
		$('#output').show();
		$('.lnum').click(function () {
			var numLine = $(this).text() - 1;
			//console.log('lnum:', numLine);	// DBG
			$('#output').hide();
			editor.scrollIntoView(numLine, editor.getScrollInfo().clientHeight / 2);
			// Put cursor at beginning of function
			editor.setCursor({line: numLine, ch: 0});
			// Show the editor page
			editor.focus();
		});
	}
}));
submenuJavascript.append(new gui.MenuItem({
	label: 'Beautify',
	click: beautifyCode
}));

// -----------------------------
// Popup Markdown subMenu
// -----------------------------

/** @global */
/** {Instance} Create Markdown dedicated popup sub-menu */
var submenuMarkdown = new gui.Menu();
submenuMarkdown.append(new gui.MenuItem({
	label: 'Cite block of lines',
	click: function () {editor.options.extraKeys['Cmd-Alt-J'](editor); }
}));
submenuMarkdown.append(new gui.MenuItem({
	label: 'Numbered list',
	click: function () {editor.options.extraKeys['Cmd-Alt-L'](editor); }
}));
submenuMarkdown.append(new gui.MenuItem({
	label: 'Toggle Overwrite',
	click: function () {editor.options.extraKeys['Cmd-Alt-O'](editor); }
}));
submenuMarkdown.append(new gui.MenuItem({
	label: 'Bold',
	click: function () {editor.options.extraKeys['Cmd-B'](editor); }
}));
submenuMarkdown.append(new gui.MenuItem({
	label: 'Italic',
	click: function () {editor.options.extraKeys['Cmd-I'](editor); }
}));
submenuMarkdown.append(new gui.MenuItem({
	label: 'Code',
	click: function () {editor.options.extraKeys['Cmd-J'](editor); }
}));
submenuMarkdown.append(new gui.MenuItem({
	label: 'Web link',
	click: function () {editor.options.extraKeys['Cmd-K'](editor); }
}));
submenuMarkdown.append(new gui.MenuItem({
	label: 'Bullet list',
	click: function () {editor.options.extraKeys['Cmd-L'](editor); }
}));
submenuMarkdown.append(new gui.MenuItem({
	label: 'Underlined',
	click: function () {editor.options.extraKeys['Cmd-U'](editor); }
}));

// -----------------------------
// Popup HTML subMenu
// -----------------------------

/** @global */
/** {Instance} Create HTML dedicated popup sub-menu */
var submenuHTML = new gui.Menu();
submenuHTML.append(new gui.MenuItem({
	label: 'Beautify',
	click: beautifyCode
}));

// -----------------------------
// Popup CSS subMenu
// -----------------------------

/** @global */
/** {Instance} Create HTML dedicated popup sub-menu */
var submenuCSS = new gui.Menu();
submenuCSS.append(new gui.MenuItem({
	label: 'Beautify',
	click: beautifyCode
}));

// -----------------------------
// Set empty content by default
// -----------------------------

/** @global */
/** {Instance} Create popup menu item holding dedicated sub-menu */
var extItem = new gui.MenuItem({type: 'normal', label: 'No Extensions'});

// -----------------------------
// Popup context menu
// -----------------------------

/**
 * Create GUI context menu<br>
 * Called by: win.on 'loaded' webkit App event<br>
 */
function initContextMenu() {
	menu = new gui.Menu();
	// menu.items[0]
	menu.append(new gui.MenuItem({
		label: 'Copy',
		click: function () {
			clipboard.set(editor.getSelection());
		}
	}));
	// menu.items[1]
	menu.append(new gui.MenuItem({
		label: 'Cut',
		click: function () {
			clipboard.set(editor.getSelection());
			editor.replaceSelection('');
		}
	}));
	// menu.items[2]
	menu.append(new gui.MenuItem({
		label: 'Paste',
		click: function () {
			editor.replaceSelection(clipboard.get());
		}
	}));
	// menu.items[3]
	// No possible keyboard shortcut
	// Cmd-J, Cmd-G, etc... are already defined
	menu.append(new gui.MenuItem({
		label: 'Goto Line',
		click: gotoLine
	}));
	// menu.items[4]
	menu.append(new gui.MenuItem({ type: 'separator' }));
	// menu.items[5]
	menu.append(extItem);	// Set submenu

   /**
	* Display context menu on mouse right-button<br>
	* Called by: mouse event<br>
	*/
	document.getElementById('editor').addEventListener('contextmenu',
		function (ev) {
			ev.preventDefault();
			menu.popup(ev.x, ev.y);
			return false;
		}
	);
}

/**
 * Save nodEdit context in JSON file on application exit<br>
 * Called by: win.on 'close' event<br>
 */
function saveOnQuit() {
	// Avoid tray duplication on reload
	if (tray) {
		tray.remove();
		tray = null;
	}
	// Record last context
	lastContext.file = fileEntry;
	lastContext.cursor = editor.getCursor();
	var jsonString = JSON.stringify(lastContext, null, ' ');
	//console.log('lastcontext.json', jsonString);	// DBG
	fs.writeFileSync('node_modules/lastcontext.json', jsonString);
	//gui.App.clearCache();
	// NOTE: Return 'false' cause a confirmation
	// dialog to popup on quit (uncomfortable)
	//return false;
}

/**
 * Edit file dropped into footer area (#holder)<br>
 * Hold 'Alt' key to create a new 'README.md'
 * default file in the dropped directory<br>
 * Called by: holder.ondrop event<br>
 * @param {Object} e - Event containing the full path of the target
 */
function editDropFile(e) {
	e.preventDefault();
	// Drop event contains Booleans:
	// e.altKey, e.ctrlKey, e.metaKey and shiftKey
	this.className = '';
	// Display first file/folder dropped into 'holder' area
	// NOTE: Drag & Drop returns the full path of the target
	var file = e.dataTransfer.files[0].path;
	var stats = fs.lstatSync(file);
	var ext  = path.extname(file);
	console.log('Drop:', file);	// DBG

	//if (stats.isFile() && settings.doc_ext.indexOf(ext) >= 0) {
	if (stats.isFile()) {
		setFile(file, false);
		readFileIntoEditor(file);
	}
	else if (stats.isDirectory()) {
		//if (e.altKey) {	// Useless option key..!
		if (true) {
			// Create a new 'README.md' file in 'file' directory
			// WARN: 'file' path is global and shall be updated
			console.log('Alt+Drop event in:', file);	// DBG
			var location = file;	// Base directory path
			var newFile = 'README.md';	// Default file name
			file = path.join(location, newFile);
			if (fs.existsSync(file)) {
				// You may want to choose another file name or edit its content
				newFile = prompt('A note named "README.md"\nAlready exists in directory:\n' + location + '\nEdit its content or enter another file name', newFile);
				if (!newFile) {
					console.log('Cancel create file');	// DBG
					return;
				}
				file = path.join(location, newFile);
			}
			console.log('Select file:', file);	// DBG
			try {
				if (!fs.existsSync(file)) {
					// Create a new file
					console.log('Create file:', file);	// DBG
					fs.writeFileSync(file, '#Default Title\n' + (new Date().toISOString().substr(0, 10)) + '\n\n> Abstract\n\nMarkdown file **' + newFile + '** created in folder `' + location + '`\n');
				}
				// Read back the existing or new file
				// and display it in the editor
				console.log('Edit file:', file);	// DBG
				setFile(file, false);
				readFileIntoEditor(file);
			}
			catch (err) {
				console.log(err.message);
			}
		}
	}
}	// end editDropFile

/**
 * Auto fill Javascript and C-Like on typing keywords.<br>
 * Type ahead is triggered only if the token is recognized by CodeMirror.
 * @param {Instance} cm - Code Mirror instance
 * @param {Object} changeObj - gives {from, to, text, next} data
 */
function autoFill(cm, changeObj) {
	//console.log('Editor change event', changeObj, cm.getTokenAt(cm.getCursor()));	// DBG
	//Filter triggering conditions to avoid spurious template insertion
	// 1. Check language
	if (mode !== 'javascript' && mode !== 'text/x-c' && mode !== 'text/x-java') {return; }
	// 2. Test if cursor is at EOL
	var pos = cm.getCursor();
	if (cm.getLine(pos.line).length !== pos.ch) {return; }
	// 3. Ignore keyword on delete sequence
	if (changeObj.origin === '+delete') {return; }
	// -----------------------------
	// Auto-fill Javascript keywords
	// -----------------------------
	var token = cm.getTokenAt(pos);
	if (token.type === 'keyword') {
		//console.log('Token:', token.string);	// DBG
		switch (token.string) {
		case 'if':
		case 'while':
			cm.replaceRange(' () {\n// Then...\n}', pos);
			cm.indentLine(pos.line + 1);
			cm.indentLine(pos.line + 2);
			cm.setCursor({line: pos.line, ch: pos.ch + 2});
			break;
		case 'else':
			cm.replaceRange(' {\n// Otherwise...\n}', pos);
			cm.indentLine(pos.line + 1);
			cm.indentLine(pos.line + 2);
			cm.setCursor({line: pos.line + 1, ch: 999});
			break;
		case 'for':
			cm.replaceRange(' (;;) {\n// Action...\n}', pos);
			cm.indentLine(pos.line + 1);
			cm.indentLine(pos.line + 2);
			cm.setCursor({line: pos.line, ch: pos.ch + 2});
			break;
		case 'switch':
			cm.replaceRange(' () {\ncase :\n// Do...\nbreak;\ndefault:\n// Otherwise...\n}', pos);
			cm.indentLine(pos.line + 1);
			cm.indentLine(pos.line + 2);
			cm.indentLine(pos.line + 3);
			cm.indentLine(pos.line + 4);
			cm.indentLine(pos.line + 5);
			cm.setCursor({line: pos.line, ch: pos.ch + 2});
			break;
		case 'function':
			cm.replaceRange(' NAME() {\n// Body...\n}', pos);
			cm.indentLine(pos.line + 1);
			cm.indentLine(pos.line + 2);
			cm.setSelection({line: pos.line, ch: pos.ch + 1}, {line: pos.line, ch: pos.ch + 5});
			cm.replaceRange('/**\n * Doc string @param @returns...\n */\n', {line: pos.line, ch: 0});
			break;
		case 'do':
			cm.replaceRange(' {\n// Action...\n} while ();', pos);
			cm.indentLine(pos.line + 1);
			cm.indentLine(pos.line + 2);
			cm.setCursor({line: pos.line + 2, ch: cm.lineInfo(pos.line + 2).text.length - 2});
			break;
		default:
			console.log('Ignored');
		}
	}
}

// =============================
//   INIT ON DOCUMENT LOADED
// =============================

/**
 * Initialize application<br>
 * Replace window.onload = function () {...}<br>
 * Called by: win.on 'loaded' webkit App even<br>
 */
win.on('loaded', function () {
	// Setup main menu
	if (process.platform === 'darwin') {
		// Create tray menu
		tray = new gui.Tray({
			title: 'nodEdit',
			icon: 'img/16x16/16.png',
			alticon: 'img/16x16/16red.png'
		});
		// Give a menu to the tray icon
		tray.menu = subMenu;
	}
	else if (process.platform === 'linux' && !gui.Window.get().menu) {
		// Create a menu in the screen/window top bar
		// Prevent menu duplication on window 'reload'
		var winMenu = new gui.Menu({ 'type': 'menubar' });
		// Add winMenu.items[0]
		winMenu.append(new gui.MenuItem({
			type: 'normal',
			label: 'Options'
		}));
		// Add subMenu to the winMenu item 'Options'
		winMenu.items[0].submenu = subMenu;
		// Then display winMenu instead of trayMenu
		gui.Window.get().menu = winMenu;
	}

	// -------------------------
	// Refer to:
	// http://stackoverflow.com/questions/13443503/how-to-run-javascript-code-on-window-close
	// https://github.com/rogerwang/node-webkit/wiki/Window
	// -------------------------

	/**
	 * Register window close event to save settings<br>
	 * window.onbeforeunload = saveOnQuit;<br>
	 * Use instead the specified webkit method
	 * to also respond to manual close window.
	 */
	win.on('close', function () {
		this.hide(); // Pretend to be closed already
		saveOnQuit();
		this.close(true);
	});

	// -------------------------
	// Setup Drag & Drop area as per:
	// https://github.com/rogerwang/node-webkit/wiki/Dragging-files-into-page
	// -------------------------
	// NOTE: 'event.returnValue' is deprecated.

	/**
	 * Prevent default window.ondragover action
	 */
	window.ondragover = function (e) {
		e.preventDefault();
		return false;
	};

	/**
	 * Prevent default window.ondrop action
	 */
	window.ondrop = function (e) {
		e.preventDefault();
		return false;
	};

	/**
	 * while 'ondragover'
	 * Highlight footer '#holder' area
	 * and select header button '#open' programmatically
	 */
	var holder = document.getElementById('holder');
	holder.ondragover = function () {
		this.className = 'hover';
		$('#open').addClass('jqhover');
	};
	// DISCARD funny but non realistic button shape animation
	//holder.ondragover = function () { this.className = 'hover'; $('#open').addClass('animated rubberBand'); };
	//holder.ondragover = function () { this.className = 'hover'; $('header').addClass('animated shake'); };

	/**
	 * Restore footer '#holder' and header
	 * button '#open' style when 'ondragleave' occurs
	 */
	holder.ondragleave  = function () {
		this.className = '';
		$('#open').removeClass('jqhover');
	};
	// DISCARD funny but non realistic button shape animation
	//holder.ondragleave  = function () { this.className = ''; $('#open').removeClass('animated rubberBand'); };
	//holder.ondragleave  = function () { this.className = ''; $('header').removeClass('animated shake'); };

	/**
	 * Handle drop event
	 * Restore footer '#holder' and header
	 * call 'editDropFile(event)'
	 */
	holder.ondrop = function (ev) {
		this.className = '';
		$('#open').removeClass('jqhover');
		editDropFile(ev);
	};

	/**
	 * Manage show/hide window command
	 * from tray menu or window button
	 */
	win.on('minimize', function () {
		console.log('Minimize');	// DBG
		subMenu.items[0].enabled = false;
		subMenu.items[1].enabled = true;
		if (win.isDevToolsOpen()) {
			win.closeDevTools();
		}
	});
	win.on('restore', function () {
		console.log('Restore');	// DBG
		subMenu.items[0].enabled = true;
		subMenu.items[1].enabled = false;
	});

	// References to jQuery DOM elements
	// -------------------------
	outPage = $('#output');

	// References to native DOM elements
	// -------------------------
	newButton = document.getElementById('new');
	openButton = document.getElementById('open');
	saveButton = document.getElementById('save');
	runButton = document.getElementById('run');
	viewButton = document.getElementById('view');

	// Register mouse left-click event
	// -------------------------
	// New button REPLACED by CSS 'New" menu and sub-menu
	//newButton.addEventListener('click', handleNewButton);
	// -------------------------
	openButton.addEventListener('click', handleOpenButton);
	saveButton.addEventListener('click', handleSaveButton);
	runButton.addEventListener('click', handleRunButton);
	viewButton.addEventListener('click', handleViewButton);

	// Create editor popup context menu
	// -------------------------
	initContextMenu();

	/**
	 * Register file chooser 'save' event
	 */
	$('#saveFile').change(function (evt) {
		onChosenFileToSave($(this).val());
	});

	/**
	 * Set open file default path to HOME
	 * Refer to:
	 * https://github.com/rogerwang/node-webkit/wiki/File-dialogs
	 */
	$('#openFile').attr('nwworkingdir', process.env.HOME);

	/**
	 * Register file chooser 'open' event
	 */
	$('#openFile').change(function (evt) {
		onChosenFileToOpen($(this).val());
	});

	// http://stackoverflow.com/questions/14919459/using-jquery-on-to-watch-for-enter-key-press
	// http://www.quirksmode.org/js/events_order.html
	// -------------------------------------
	// Solve conflict with buttons activation
	// Ctrl-Q and win.close() kill process but
	// window.close() is correctly executed
	// -------------------------------------
	//$(document).keypress(function (event) {...}
	// Prefer 'keydown' so the same keyCodes
	// are received under Linux and Darwin
	// -------------------------------------

	/**
	 * Register keyboard shortcuts on OS-X/Linux
	 */
	$(document).keydown(function (event) {
		if (event.ctrlKey) {
			event.stopPropagation();
			console.log('Keyboard event keyCode/ctrlKey:', event.keyCode, event.ctrlKey);	// DBG
			switch (event.keyCode) {
				case 32:
					// [Ctrl-SPACE]
					// Recall last context
					subMenu.items[2].click();
					break;
				case 76:
					// [Ctrl-L]
					// Reload browser page
					subMenu.items[7].click();
					break;
				case 87:
					// [Ctrl-W]
					// Toggle Debug Window
					event.preventDefault();
					subMenu.items[3].click();
					break;
				case 78:
					// [Ctrl-N]
					// Create new file
					handleNewButton();
					break;
				case 79:
					// [Ctrl-O]
					// Open file chooser
					handleOpenButton();
					break;
				case 81:
					// [Ctrl-Q] Linux case
					gui.App.quit();
					//gui.App.closeAllWindows();
					break;
				default:
					$.noop();
			}
			return false;
		}
	});

   /**
	* Configure highlight.pack to replace 'tab' by 4 spaces<br>
	* Refer to http://highlightjs.org/usage/<br>
	* @param {Object} hljs options
	*/
	hljs.configure({tabReplace: '    '});

   /**
	* Initialize word completion addon<br>
	* Called by: [Ctrl-SPACE] key event<br>
	* @param {Instance} cm - CodeMirror editor
	*/
	CodeMirror.commands.autocomplete = function (cm) {
		CodeMirror.showHint(cm, CodeMirror.hint.anyword);
	};

   /**
	* Create CodeMirror instance<br>
	* Most options are managed by handleDocumentChange()<br>
	* @param {Element} DOM CodeMirror editor<br>
	* @param {Object} options
	*/
	editor = new CodeMirror(
		document.getElementById('editor'),
		{
			value: '',
			mode: 'javascript',
			lineNumbers: true,
			styleSelectedText: true,
			indentUnit: tabWidth,
			indentWithTabs: true,
			lineWrapping: true,
			matchBrackets: true,
			autoCloseBrackets: true,
			styleActiveLine: true,
			showTrailingSpace: true,
			theme: 'monokai',
			gutters: ['CodeMirror-lint-markers'],
			lint: true,
			rulers: null,
			extraKeys: extraKeys
		}
	);

	/**
	 * Hide 'Save' button on top bar
	 */
	$('#save').hide();

	/**
	 * Register click in gutter to select the entire line(s) from last cursor position
	 */
	editor.on('gutterClick', function (cm, n) {
		console.log('gutter click', cm.getCursor().line, n);	// DBG
		cm.setSelection({line: cm.getCursor().line, ch: 0}, {line: n + 1, ch: 0});
	});

	/**
	 * Register New Document sub-menu click
	 */
	$('#new ul li').click(function () {
		var docType = $(this).attr('type');
		//alert(docType);	// TST
		fileEntry = snippet.byName(editor, docType);
		helpCreateNewDoc();
	});

	/**
	 * Register response to every 'change' event from editor
	 */
	editor.on('change', function (cm, changeObj) {
		dirtyBit = true;
		$('#save').show();
		autoFill(cm, changeObj);
	});
	newFile();
	// Window resize handler line 1963
	// is useless with Codemirror-4
	//onresize();

	// Front page system information complement
	// -------------------------
	outPage.append('<pre>CodeMirror v' + CodeMirror.version + ' running node ' + process.versions.node + ' with node-webkit ' + process.versions['node-webkit'] + ' under ' + process.platform + '\nnodEdit application version ' + gui.App.manifest.version + '\n</pre>');
	outPage.show();

	// Load file from argument
	// -------------------------
	if (gui.App.argv.length > 0) {
		// Launched from command line or 'nodedit' script
		// with optional file path to open as first argument
		// https://github.com/rogerwang/node-webkit/wiki/How-to-run-apps
		var theFileArg = gui.App.argv[0];
		setFile(theFileArg, true);
		readFileIntoEditor(theFileArg);
	}

	// -------------------------
	// File 'package.json' contains option "show": false.
	// To make the app seem to start smoothly, you should
	// show the main window after everything is ready. As per:
	// https://github.com/rogerwang/node-webkit/wiki/Show-window-after-page-is-ready
	// -------------------------
	// Display 'nw.gui' window
	win.show();
	// and put focus on it
	win.focus();
});

// -----------------------------
// Window resize event handler
// Specified webkit method below crash..!
// win.on('resize', function (width, height) {...});
// Useless with Codemirror-4
// -----------------------------

/** DISABLED
 * Resize window and adjust editor page<br>
 * Called by: 'resize' even<br>
 * Make call: editor.getScrollerElement()
 */
//window.onresize = function () {
// 	var container = document.getElementById('editor');
// 	var containerWidth = container.offsetWidth;
// 	var containerHeight = container.offsetHeight;
// 	var scrollerElement = editor.getScrollerElement();
// 	scrollerElement.style.width = containerWidth + 'px';
// 	scrollerElement.style.height = containerHeight + 'px';
//	editor.refresh();
//};

//
// ------------ END ------------