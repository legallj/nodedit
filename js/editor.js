/*jshint node:true, strict: false, browser: true, jquery: true, devel: true, camelcase: false */
/* jshint -W015 */
/* jshint -W117 */
/* jshint unused:false */
/* jshint shadow:true */
/* jshint bitwise:false */

'use strict';

// NOTE: 'jshint' at https://github.com/gruntjs/grunt-contrib-jshint
// Octal literals are not allowed in strict mode, convert them to dec.
// Take '<workspace>/.jshintrc' into account then file options ✔

/**
 * @fileOverview WebApp developped under node-webkit to edit, preview and execute files<br>
 * Version dated 2014-03-21 designed for Mac OS-X
 * @requires fs
 * @requires path
 * @requires child_process
 * @require marked
 * @requires nw-gui
 */
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var marked = require('marked');
var gui = require('nw.gui');

// -----------------------------
// GLOBAL VARIABLES
// -----------------------------
/** @global */
/** Reference to the CodeMirror text editor instance */
var editor;

/** @global */
/** Reference to every button elements in DOM */
var newButton, openButton, saveButton, runButton, viewButton;

/** @global */
/** Reference to drop-down menu */
var menu;

/** @global */
/** {String} Current file full path  */
var fileEntry = null;

/** @global */
/** {Boolean} Write access flag */
var hasWriteAccess;

/** @global */
/** Reference to the WebKit clip board (paste board) */
var clipboard = gui.Clipboard.get();

/** @global */
/** Reference to the output div DOM element */
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

// -----------------------------------------
// Create Editor menu
// -----------------------------------------
/** @global */
/** Reference to the WebKit Chromium window */
var win = gui.Window.get();

/** @global */
/** Reference to submenu of the WebKit tray-menu */
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
	label: 'Reload',
	click: function () {
		win.reload();
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
subMenu.append(new gui.MenuItem({ type: 'separator' }));
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'Quit',
	tooltip: 'Close window and leave Application',
	click: function () {
		window.close();
	}
}));

/** @global */
/** Create a reference to tray icon with label */
var tray = new gui.Tray({
	title: 'nodEdit',
	icon: 'img/16x16/16.png',
	alticon: 'img/16x16/16red.png'
});
// Give a menu to the tray icon
tray.menu = subMenu;

/** @global */
/* {Object} Default editor keyboard shortcuts<br>
 * The editor must have focus to respond
 */
var defaultEditCmds = {
	'Cmd-C': function () { clipboard.set(editor.getSelection()); },
	'Cmd-X': function () { clipboard.set(editor.getSelection()); editor.replaceSelection(''); },
	'Cmd-V': function () { editor.replaceSelection(clipboard.get()); },
	'Cmd-S': function (instance) {handleSaveCmd(); },
	'Cmd-O': function (instance) {handleOpenButton(); },
	'Cmd-N': function (instance) {handleNewButton(); },
	'Shift-Cmd-S': function (instance) {handleSaveButton(); },
	'Cmd-Alt-O': function (cm) {cm.toggleOverwrite(); },
	'Ctrl-Space': 'autocomplete'
};

/** @global */
/* {Object} Markdown specific keyboard shortcuts<br>
 * The editor must have focus to respond
 */
var markdownEditCmds = {
	'Cmd-B': function (doc) { /* Bold */
		if (doc.somethingSelected()) {
			var string = doc.getSelection();
			doc.replaceSelection('**' + string + '**');
		}
	},
	'Cmd-I': function (doc) { /* Italic */
		if (doc.somethingSelected()) {
			doc.replaceSelection('_' + doc.getSelection() + '_');
		}
	},
	'Cmd-J': function (doc) { /* Italic */
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
 * Configure the editor according to doc-type
 * @param {String} title - Full path of the target file
 */
function handleDocumentChange(title) {
	$('button#run').hide();
	$('button#view').hide();
	// Default 'js' edit parameters
	mode = 'javascript';
	var modeName = 'JavaScript';
	var lint = true;
	var theme = 'monokai';
	if (title) {
		console.log('title:', title);	// DBG
		// Hide output page if displayed
		outPage.hide();
		// Get file name without its leading path (basename)
		title = path.basename(title);
		document.getElementById('title').innerHTML = title;
		document.title = title;
		extraKeys = defaultEditCmds;
		// Test file extension
		switch (path.extname(title)) {
		case '.js':
			mode = 'javascript';
			modeName = 'JavaScript';
			$('button#run').show();
			break;
		case '.json':
			mode = {name: 'javascript', json: true};
			modeName = 'JavaScript (JSON)';
			break;
		case '.html':
			mode = 'htmlmixed';
			modeName = 'HTML';
			lint = false;
			$('button#view').show();
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
			lint = false;
			theme = 'solarized light';
			// Use jQuery function to extend the keyMap
			// -------------
			// NOTE: Keep in mind that the target object (first argument)
			// will be modified, and will also be returned from $.extend().
			// If, however, you want to preserve both of the original
			// objects, you can do so by passing an empty object as the target.
			// -------------
			extraKeys = $.extend({}, defaultEditCmds, markdownEditCmds);
			$('button#view').show();
			break;
		case '.sh':
			mode = 'shell';
			modeName = 'Shell';
			lint = false;
			$('button#run').show();
			break;
		default :
			mode = 'text/plain';
			modeName = 'Plain text';
			theme = 'default';
			lint = false;
		} // end switch
	}
	else {
		console.log('No file, edit a new document');	// DBG
		document.getElementById('title').innerHTML = '[no document loaded]';
		mode = 'text/plain';
		modeName = 'Plain text';
		theme = 'default';
		lint = false;
	} // end if
	console.log('Found doc type:', mode);	// DBG
	editor.setOption('mode', mode);
	editor.setOption('lint', lint);
	editor.setOption('theme', theme);
	editor.setOption('extraKeys', extraKeys);
	document.getElementById('mode').innerHTML = modeName;
	// New clean document
	dirtyBit = false;
	$('save').hide();
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
	fileEntry = null;
	hasWriteAccess = true;
	handleDocumentChange(null);
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
 * Make call: handleDocumentChange()
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
 * Make call: handleDocumentChange()
 * @param {String} theFileEntry - Full path of the current file
 */
function writeEditorToFile(theFileEntry) {
	fs.writeFile(theFileEntry, editor.getValue(), function (err) {
		if (err) {
			console.log('Write failed: ' + err);	// DBG
			return err;
		}
		// Octal 0777:0666
		var xxx = (mode === 'shell') ? 511:438;
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
 * Make call: setFile(), readFileIntoEditor()
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
 * Make call: setFile(), writeEditorToFile()
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
 * Make call: editor.setValue()
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
 * Run file button event handlers,
 * try to execute Node or Shell file providing
 * they are executable as a child process<br>
 * Called by: runButton.addEventListener()<br>
 */
function handleRunButton() {
	if (outPage.is(':visible')) {
		outPage.hide();
		editor.focus();
		$('#run').text('Run');
		return;
	}
	console.log('Run handler on file', fileEntry);	// DBG
	var args = prompt('Execution arguments');
	if (args === null) {return; }	// Cancel
	console.log('Arguments:', args);	// DBG
	fs.stat(fileEntry, function (err, stats) {
		//console.log('stats:', stats);	// DBG
		// Octal constant 0111 to check if 'executable'
		var xxx = stats.mode & 73;
		if (stats.isFile() && xxx === 73) {
			console.log('File executable by', process.env.USER);
			childProcess.execFile(fileEntry, [args], null, function (error, stdout, stderr) {
				if (error !== null) {
					console.log('exec error: ' + error);
				}
				console.log('stderr: ' + stderr);
				outPage.html('<pre>' + stdout.toString() + '</pre>');
				$('<pre />').text(stderr.toString()).css('color', 'red').prependTo(outPage);
			});
		}
		else {
			outPage.html($('<pre />').text('Execute file:\n' + fileEntry + '\nPermission denied..!').css('color', 'red'));
		}
		outPage.show();
		$('#run').text('Edit');
	});
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
		console.log('Hide output');
		outPage.hide();
		$('#view').text('View');
	}
	else {
		console.log('Show output');
		outPage.html(marked(editor.getValue()));
		outPage.show();
		$('#view').text('Edit');
	}
}
/**
 * Save file on keyboard command 'Cmd-S'<br>
 * Called by: defaultEditCmds entry<br>
 */
function handleSaveCmd() {
	console.log('Save file:', fileEntry);	// DBG
	if (!fileEntry) {return; }	// No file name, use 'save as' instead
	var err = writeEditorToFile(fileEntry);
	console.log('File saved', (err ? 'ERROR':'Ok'));
	dirtyBit = false;
	$('#save').hide();
}

// -----------------------------
// Popup context menu
// -----------------------------
/**
 * Create GUI context menu<br>
 * Called by: onload even handler<br>
 */
function initContextMenu() {
	menu = new gui.Menu();
	menu.append(new gui.MenuItem({
		label: 'Copy',
		click: function () {
			clipboard.set(editor.getSelection());
		}
	}));
	menu.append(new gui.MenuItem({
		label: 'Cut',
		click: function () {
			clipboard.set(editor.getSelection());
			editor.replaceSelection('');
		}
	}));
	menu.append(new gui.MenuItem({
		label: 'Paste',
		click: function () {
			editor.replaceSelection(clipboard.get());
		}
	}));
/**
 * Display context menu on mouse right-button<br>
 * Called by: mouse event<br>
 */
document.getElementById('editor').addEventListener('contextmenu',
	function (ev) {
		ev.preventDefault();
		menu.popup(ev.x, ev.y);
		return false;
	});
}

// =============================
//   INIT ON DOCUMENT LOADED
// =============================
/**
 * Initialize application<br>
 * Called by: onload even<br>
 */
window.onload = function () {
	// Avoid tray duplication on reload
	window.onbeforeunload = function () { tray.remove(); tray = null; };

	// Manage show/hide window command
	// from tray menu or window button
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

	outPage = $('#output');
	initContextMenu();

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

	$('#saveFile').change(function (evt) {
		onChosenFileToSave($(this).val());
	});
	$('#openFile').change(function (evt) {
		onChosenFileToOpen($(this).val());
	});

	// Register keyboard shortcuts on Mac OS-X
	// http://stackoverflow.com/questions/14919459/using-jquery-on-to-watch-for-enter-key-press
	// -------------------------------------
	// TODO Conflict with buttons activate
// 	if (process.platform === 'darwin') {
// 		$(document).keypress(function (event) {
// 			console.log('Keyboard event:', event.keyCode, event.ctrlKey);	// DBG
// 			if (event.ctrlKey) {
// 				switch (event.keyCode) {
// 					case 0:
// 						// [Ctrl-SPACE]
// 						// Hide output page
// 						$('#output').hide();
// 						break;
// 					case 15:
// 						// [Ctrl-O]
// 						// Open file
// 						handleOpenButton();
// 						break;
// 					case 13:
// 						// [Ctrl-ENTER]
// 						// Not assigned
// 						break;
// 					case 14:
// 						// [Ctrl-N]
// 						// Create new file
// 						handleNewButton();
// 						break;
// 					default:
// 						$.noop();
// 				}
// 			}
// 		});
// 	}

	CodeMirror.commands.autocomplete = function (cm) {
		CodeMirror.showHint(cm, CodeMirror.hint.anyword);
	};
	editor = new CodeMirror(
		document.getElementById('editor'),
		{
			value: '',
			mode: 'javascript',
			lineNumbers: true,
			styleSelectedText: true,
			indentUnit: 4,
			indentWithTabs: true,
			lineWrapping: true,
			matchBrackets: true,
			autoCloseBrackets: true,
			styleActiveLine: true,
			showTrailingSpace: true,
			theme: 'monokai',
			gutters: ['CodeMirror-lint-markers'],
			lint: true,
			extraKeys: extraKeys
		}
	);
	$('#save').hide();
	editor.on('change', function (instance, changeObj) {
		dirtyBit = true;
		$('#save').show();
		//console.log('Editor change event');
	});
	newFile();
	onresize();

	// Front page system information complement
	outPage.append('<pre>CodeMirror-3.22 running node-webkit ' + process.version + ' under ' + process.platform + '\nOpen or create a new file...\n</pre>');
	outPage.show();

	// Display window
	win.show();
	// and put focus on it
	win.focus();
};

// -----------------------------
// Window resize event handler
// -----------------------------
/**
 * Resize window and adjust editor page<br>
 * Called by: resize even<br>
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