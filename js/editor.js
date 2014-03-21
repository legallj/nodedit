/*jshint node:true, strict: false, browser: true, jquery: true, devel: true */
/* jshint -W015 */
/* jshint -W117 */
/* jshint unused:false */
/* jshint shadow:true */
/* jshint bitwise:false */
/* jshint latedef:nofunc */
//'use strict';

/**
 * @fileOverview WebApp developped under node-webkit to list documents in directory<br>
 * Version dated 2014-03-12 compatible Mac and Linux
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
var newButton, openButton, saveButton, runButton, viewButton;
var menu;
var fileEntry = null;
var hasWriteAccess;
var clipboard = gui.Clipboard.get();
var outPage;
var dirtyBit = false;
var extraKeys = {};
var mode = '';

// -----------------------------------------
// Create Editor menu
// -----------------------------------------
// Create a submenu
var win = gui.Window.get();
var subMenu = new gui.Menu();
subMenu.append(new gui.MenuItem({
	type: 'normal',
	label: 'Minimize',
	enabled: true,
	click: function () {
		win.minimize();
// Handled by 'minimize' event in init
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
// Handled by 'restore' event in init
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
// Create a tray icon with label
var tray = new gui.Tray({
	title: 'nodEdit',
	icon: 'img/16x16/16.png',
	alticon: 'img/16x16/16red.png'
});
// Give a menu to the tray icon
tray.menu = subMenu;

// ---------- Default ----------
// Edit help keyboard shortcuts
// The editor must have focus to respond
// -----------------------------
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

// --------- Markdown ----------
// Edit help keyboard shortcuts
// The editor must have focus to respond
// -----------------------------
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
		if (!doc.somethingSelected()) return;
		var begin = doc.getCursor('start');
		var end = doc.getCursor('end');
		for (var ln = begin.line; ln < end.line; ln++) {
			doc.setCursor({line: ln, ch: 0});
			doc.replaceSelection('> ');
		}
		doc.setCursor(end);
	},
	'Cmd-K': function (doc) { /* Web Link */
		if (!doc.somethingSelected()) return;
		doc.replaceSelection('[' + doc.getSelection() + ']( \'\')');
		var pos = doc.getCursor();
		pos.ch -= 4;
		doc.setCursor(pos);
	},
	'Cmd-L': function (doc) { /* Bullet List */
		if (!doc.somethingSelected()) return;
		var begin = doc.getCursor('start');
		var end = doc.getCursor('end');
		for (var ln = begin.line; ln < end.line; ln++) {
			doc.setCursor({line: ln, ch: 0});
			doc.replaceSelection('- ');
		}
		doc.setCursor(end);
	},
	'Cmd-Alt-L': function (doc) { /* Numbered List */
		if (!doc.somethingSelected()) return;
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
// Configure editor for doc-type
// -----------------------------
// RegExp tester http://regex101.com/
// -----------------------------
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
function newFile() {
	fileEntry = null;
	hasWriteAccess = true;
	handleDocumentChange(null);
}
// -----------------------------
function setFile(theFileEntry, isWritable) {
	fileEntry = theFileEntry;
	hasWriteAccess = isWritable;
	console.log('setFile:', fileEntry);	// DBG
}
// ---------- Open -------------
function readFileIntoEditor(theFileEntry) {
	// Check if some selection was made
	if (!theFileEntry) return;
	fs.readFile(theFileEntry, function (err, data) {
		if (err) {
			console.log('Read failed: ' + err);	// DBG
		}
		handleDocumentChange(theFileEntry);
		// Fill editor page
		editor.setValue(String(data));
		dirtyBit = false;
		$('#save').hide();
	});
}
// ----------- Save ------------
function writeEditorToFile(theFileEntry) {
	fs.writeFile(theFileEntry, editor.getValue(), function (err) {
		if (err) {
			console.log('Write failed: ' + err);	// DBG
			return err;
		}
		var xxx = (mode === 'shell') ? 0777:0666;
		fs.chmod(theFileEntry, xxx, function (err) {
			handleDocumentChange(theFileEntry);
			console.log('Write completed with mode:', xxx);	// DBG
			return err;
		});
	});
}

// -----------------------------
// File browser event handlers
// -----------------------------
var onChosenFileToOpen = function (theFileEntry) {
	if (!theFileEntry) return;	// Cancel
	setFile(theFileEntry, false);
	readFileIntoEditor(theFileEntry);
};
// -----------------------------
var onChosenFileToSave = function (theFileEntry) {
	if (!theFileEntry) return;	// Cancel
	setFile(theFileEntry, true);
	writeEditorToFile(theFileEntry);
};

// -----------------------------
// Command handlers
// --------- Buttons -----------
function handleNewButton() {
	if (true) {	// Oops.!?
		newFile();
		editor.setValue('New plain text file');
		dirtyBit = false;
		$('#save').hide();
		outPage.hide();
	}
	else {
		// Open a separate window
		var x = window.screenX + 10;
		var y = window.screenY + 10;
		window.open('main.html', '_blank', 'screenX=' + x + ',screenY=' + y);
	}
}
// --------- Buttons -----------
function handleOpenButton() {
	$('#openFile').trigger('click');
}
// --------- Buttons -----------
function handleSaveButton() {
//	if (fileEntry && hasWriteAccess) {
	if (false) {
		writeEditorToFile(fileEntry);
	}
	else {
		$('#saveFile').trigger('click');
	}
}
// --------- Buttons -----------
function handleRunButton() {
	if (outPage.is(':visible')) {
		outPage.hide();
		$('#run').text('Run');
		return;
	}
	console.log('Run handler on file', fileEntry);	// DBG
	var args = prompt('Execution arguments');
	console.log('Arguments:', args);	// DBG
	fs.stat(fileEntry, function (err, stats) {
		//console.log('stats:', stats);	// DBG
		// Octal constant 0111 to check if 'executable'
		var xxx = stats.mode & 0111;
		if (stats.isFile() && xxx === 0111) {
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
// var view = false;	// Zepto 1/2
function handleViewButton() {
	console.log('View handler');
//	if (view) {	// Zepto 2/2
	if (outPage.is(':visible')) {
		console.log('Hide output');
		outPage.hide();
		$('#view').text('View');
//		view = false;
	}
	else {
		console.log('Show output');
		outPage.html(marked(editor.getValue()));
		outPage.show();
		$('#view').text('Edit');
//		view = true;
	}
}
// --------- Keyboard ----------
function handleSaveCmd() {
	console.log('Save file:', fileEntry);	// DBG
	if (!fileEntry) return;	// No file name, use 'save as' instead
	var err = writeEditorToFile(fileEntry);
	console.log('File saved', (err ? 'ERROR':'Ok'));
	dirtyBit = false;
	$('#save').hide();
}

// -----------------------------
// Popup context menu
// -----------------------------
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
// -----------------------------
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
onload = function () {
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
// 						// Toggle display between 'preview' and 'editor'
// 						$('footer').click();
// 						break;
// 					case 13:
// 						// [Ctrl-ENTER]
// 						// Switch from 'preview' or 'editor' to 'doclist'
// 						$('header').click();
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
onresize = function () {
	var container = document.getElementById('editor');
	var containerWidth = container.offsetWidth;
	var containerHeight = container.offsetHeight;

	var scrollerElement = editor.getScrollerElement();
	scrollerElement.style.width = containerWidth + 'px';
	scrollerElement.style.height = containerHeight + 'px';

	editor.refresh();
};
