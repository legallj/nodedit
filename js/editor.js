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
 * Version dated 2014-03-21 designed for Mac OS-X
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
});

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
		// window without navigation bar
		var new_win = gui.Window.open('about.html', {
			position: 'center',
			toolbar: true,
			width: 800,
			height: 600
		});
		new_win.moveTo(150, 100);
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

/** @global */
/** {Reference} Reference to tray icon with label */
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
		'Cmd-C': function (cm) { clipboard.set(editor.getSelection()); },
		'Cmd-X': function (cm) { clipboard.set(editor.getSelection()); editor.replaceSelection(''); },
		'Cmd-V': function (cm) { editor.replaceSelection(clipboard.get()); },
		'Cmd-S': function (cm) {handleSaveCmd(); },
		'Cmd-O': function (cm) {handleOpenButton(); },
		'Cmd-N': function (cm) {handleNewButton(); },
		'Cmd-Q': function (cm) {
				saveOnQuit();
				gui.App.quit();
				//gui.App.closeAllWindows();
			},
		'Shift-Cmd-S': function (cm) {handleSaveButton(); },
		'Cmd-Alt-O': function (cm) {cm.toggleOverwrite(); },
		'Cmd-D': 'goPageDown',
		'Cmd-U': 'goPageUp',
		'Ctrl-Space': 'autocomplete',
		'Ctrl-U': 'deleteLine',
		'Ctrl-T': 'toggleComment',
	// 	'Ctrl-T': function (cm) {
	// 			if (cm.getTokenAt(cm.getCursor()).type !== 'comment') cm.execCommand('toggleComment');
	// 		},
		'Enter': 'newlineAndIndentContinueComment'
	};
}
else if (process.platform === 'linux') {
	defaultEditCmds = {
		'Ctrl-C': function (cm) { clipboard.set(editor.getSelection()); },
		'Ctrl-X': function (cm) { clipboard.set(editor.getSelection()); editor.replaceSelection(''); },
		'Ctrl-V': function (cm) { editor.replaceSelection(clipboard.get()); },
		'Ctrl-S': function (cm) {handleSaveCmd(); },
		'Ctrl-O': function (cm) {handleOpenButton(); },
		'Ctrl-N': function (cm) {handleNewButton(); },
		'Ctrl-Q': function (cm) {
				saveOnQuit();
				gui.App.quit();
				//gui.App.closeAllWindows();
			},
		'Shift-Ctrl-S': function (cm) {handleSaveButton(); },
		'Ctrl-Alt-O': function (cm) {cm.toggleOverwrite(); },
		'Ctrl-D': 'goPageDown',
		'Ctrl-U': 'goPageUp',
		'Ctrl-Space': 'autocomplete',
		'Shift-Ctrl-U': 'deleteLine',
		'Ctrl-T': 'toggleComment',
	// 	'Ctrl-T': function (cm) {
	// 			if (cm.getTokenAt(cm.getCursor()).type !== 'comment') cm.execCommand('toggleComment');
	// 		},
		'Enter': 'newlineAndIndentContinueComment'
	};
}

// -----------------------------------------
// The editor must have focus to respond
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
			doc.replaceSelection('_' + doc.getSelection() + '_');
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
		// Get file name without its leading path (basename)
		var title = path.basename(filePath);
		document.getElementById('title').innerHTML = title;
		document.title = title;
		var ext = path.extname(filePath);
		var dir = path.dirname(filePath);
		extraKeys = defaultEditCmds;
		menu.items[5].enabled = false;
		lint = false;
		editor.setOption('rulers', null);
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
			$('#run').show();
			break;
		case '.json':
			mode = {name: 'javascript', json: true};
			modeName = 'JavaScript (JSON)';
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
			$('#view').show();
			break;
		case '.css':
			mode = 'css';
			modeName = 'CSS';
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
			extItem.submenu = submenuMarkdown;
			menu.items[5].enabled = true;
			$('button#view').show();
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
			$('view').hide();
		} // end switch
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
 * Write editor text content into file and adjust UNIX 'rwx' mode<br>
 * Called by: onChosenFileToSave event handler, handleSaveButton(), handleSaveCmd()<br>
 * Make call: handleDocumentChange()<br>
 * @param {String} theFileEntry - Full path of the current file<br>
 * @returns {Object} null or write error object
 */
function writeEditorToFile(theFileEntry) {
	fs.writeFile(theFileEntry, editor.getValue(), function (err) {
		if (err) {
			console.log('Write failed: ' + err);	// DBG
			return err;
		}
		// Octal 0777 or 0666 i.e. 'rwx' or 'rw-' file mode
		var xxx = (mode === 'shell' || mode === 'javascript') ? 511:438;
		fs.chmod(theFileEntry, xxx, function (err) {
			handleDocumentChange(theFileEntry);
			console.log('Write completed with mode:', xxx);	// DBG
			return err;
		});
	});
}

// -----------------------------
// File chooser event handlers
// -----------------------------
/**
 * Open file chooser event handlers<br>
 * Called by: readFileIntoEditor event handler<br>
 * Make call: setFile(), readFileIntoEditor()<br>
 * @param {String} theFileEntry - Full path of the current file
 */
var onChosenFileToOpen = function (theFileEntry) {
	if (!theFileEntry) {return; }	// Cancel
	setFile(theFileEntry, false);
	readFileIntoEditor(theFileEntry);
};
/**
 * Save file chooser event handlers<br>
 * Called by: save file event handler<br>
 * Make call: setFile(), writeEditorToFile()<br>
 * @param {String} theFileEntry - Full path of the current file
 */
var onChosenFileToSave = function (theFileEntry) {
	if (!theFileEntry) {return; }	// Cancel
	setFile(theFileEntry, true);
	writeEditorToFile(theFileEntry);
};

// -----------------------------
// Command handlers
// --------- Buttons -----------
/**
 * New file button event handlers<br>
 * Called by: newButton.addEventListener()<br>
 * Make call: editor.setValue()<br>
 */
function handleNewButton() {
	if (true) {
		newFile();
		editor.setValue('New plain text file');
		editor.setCursor({line: 0, ch: 0});
		editor.setSelection({line: 0, ch: 0}, {line: 1, ch: 0});	// Select line
		editor.focus();
		dirtyBit = false;
		$('#save').hide();
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
 */
function handleOpenButton() {
	$('#openFile').trigger('click');
}
/**
 * Save file button event handlers<br>
 * Called by: saveButton.addEventListener()<br>
 */
function handleSaveButton() {
//	if (fileEntry && hasWriteAccess) {
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
		$('#run').text('Run');
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
	$('#run').text('Edit');
}

// --------- Buttons -----------
// is(selector) not supported by Zepto
// for non-standard pseudo-selectors
// such as ':visible'. Then use flag
// or include jQuery instead of Zepto
// -----------------------------
/**
 * Preview Markdown file button event handlers<br>
 * Called by: viewButton.addEventListener()<br>
 */
function handleViewButton() {
	console.log('View handler');
	if (outPage.is(':visible')) {
		// The 'output' page is displayed
		// then switch to 'editor' page
		console.log('Hide output');
		outPage.hide();
		$('#view').text('View');
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
		$('#view').text('Edit');
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
		// Refresh display with new content
		new_win.reloadIgnoringCache();
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
 * Scan document to list functions<br>
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
 * Scan document to list variables<br>
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
 * Jump to a given line, stay inside editor bounds and center display
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
//		if (e.altKey) {	// Useless option key..!
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
	if (mode !== 'javascript' && mode !== 'text/x-c' && mode !== 'text/x-java') {return; }
	//console.log('Editor change event', changeObj, cm.getTokenAt(cm.getCursor()));	// DBG
	// -----------------------------
	// Auto-fill Javascript keywords
	// -----------------------------
	var pos = cm.getCursor();
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

	/**
	* Register window close event to save settings<br>
	* window.onbeforeunload = saveOnQuit;<br>
	* Use instead the specified webkit method
	* to also respond to manual close window.
	*/
	// Refer to:
	// http://stackoverflow.com/questions/13443503/how-to-run-javascript-code-on-window-close
	// https://github.com/rogerwang/node-webkit/wiki/Window
	// -------------------------
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
	window.ondragover = function (e) { e.preventDefault(); };
	/**
	* Prevent default window.ondrop action
	*/
	window.ondrop = function (e) { e.preventDefault(); };
	var holder = document.getElementById('holder');
	/**
	* Highlight '#holder' area while 'ondragover'
	*/
	holder.ondragover = function () { this.className = 'hover'; $('#open').addClass('animated rubberBand'); };
	//holder.ondragover = function () { this.className = 'hover'; $('header').addClass('animated shake'); };
	/**
	* Restore '#holder' style when 'ondragleave' occurs
	*/
	holder.ondragleave  = function () { this.className = ''; $('#open').removeClass('animated rubberBand'); };
	//holder.ondragleave  = function () { this.className = ''; $('header').removeClass('animated shake'); };
	/**
	* Handle drop event, call 'editDropFile(e)'
	*/
	holder.ondrop = editDropFile;	//function (e) {

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

	// References to DOM elements
	outPage = $('#output');

	newButton = document.getElementById('new');
	openButton = document.getElementById('open');
	saveButton = document.getElementById('save');
	runButton = document.getElementById('run');
	viewButton = document.getElementById('view');

	newButton.addEventListener('click', handleNewButton);
	openButton.addEventListener('click', handleOpenButton);
	saveButton.addEventListener('click', handleSaveButton);
	runButton.addEventListener('click', handleRunButton);
	viewButton.addEventListener('click', handleViewButton);

	// Create popup context menu
	initContextMenu();

	/**
	* Register file chooser 'save' event
	*/
	$('#saveFile').change(function (evt) {
		onChosenFileToSave($(this).val());
	});
	/**
	* Register file chooser 'open' event
	*/
	$('#openFile').change(function (evt) {
		onChosenFileToOpen($(this).val());
	});

	/**
	* Register keyboard shortcuts on Mac OS-X
	*/
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

	$(document).keydown(function (event) {
		console.log('Keyboard event keyCode/ctrlKey:', event.keyCode, event.ctrlKey);	// DBG
		if (event.ctrlKey) {
			event.stopPropagation();
			switch (event.keyCode) {
				case 32:
					// [Ctrl-SPACE]
					// Recall last context
					subMenu.items[2].click();
					break;
				case 76:
					// [Ctrl-L]
					// Reload browser page
					subMenu.items[6].click();
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
	$('#save').hide();
	
	/**
	* Register click in gutter to select the entire line(s) from last cursor position
	*/
	editor.on('gutterClick', function (cm, n) {
		console.log('gutter click', cm.getCursor().line, n);	// DBG
		cm.setSelection({line: cm.getCursor().line, ch: 0}, {line: n + 1, ch: 0});
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
	onresize();

	// Front page system information complement
	outPage.append('<pre>CodeMirror v' + CodeMirror.version + ' running node-webkit ' + process.version + ' under ' + process.platform + '\nOpen or create a new file...\n</pre>');
	outPage.show();

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
// -----------------------------
/**
 * Resize window and adjust editor page<br>
 * Called by: 'resize' even<br>
 * Make call: editor.getScrollerElement()
 */
window.onresize = function () {
	var container = document.getElementById('editor');
	var containerWidth = container.offsetWidth;
	var containerHeight = container.offsetHeight;

	var scrollerElement = editor.getScrollerElement();
	scrollerElement.style.width = containerWidth + 'px';
	scrollerElement.style.height = containerHeight + 'px';

	editor.refresh();
};
//
// ------------ END ------------