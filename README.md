#nodEdit
v0.2.1 dated 2014-05-07

> Minimal IDE dedicated to single page application (SPA) development under NodeJS with WebKit. This simple tool implements the read - execute - print - loop (REPL) paradigme using only HTML5, CSS3 and Javascript to develop/debug Shell and Python scripts, HTML and NodeJS code as well as Markdown or plain text documentation files.

##Rationales

The goal of this development was to provide *just what you need and no more*, avoiding clobbered graphic user interface (no Eclipse like GUI) and nearly useless exotic functions (like FTP and SVN support). Don't forget the UNIX golden rule as in the early 70's and keep in mind that small is beautiful..!

##Main features

- Drag &amp; drop file to open.
- Drag &amp; drop folder to create a README.md file in it.
- Create new file from various snippet types.
- Provide formatting helper functions specific to file type.
- List functions and variables in Javascript files with line number (goto line included).
- Execute Shell, Python, etc. scripts and *Compile &amp; Run* C and Java programs.
- Edit remote file using host <code>scp</code> (no password management).
- Preview Markdown with code blocks highlighting.
- Preview HTML in a separate window and refresh rendering on save.
- Convert *SCSS* to *CSS* using host <code>sassc</code> tool.
- Include help page (in a separate window) and video tutorials (in default WebBrowser).

##Platform

Designed for Mac OSX-10.6+ and compatible with Linux/Ubuntu-12.04+ and Debian (but need some node-webkit tweaks to run under Debian-7)

##Getting Started

On launch, the so called Front-Page is displayed. From there, *Drag &amp; Drop* a file into the page footer to open it (or press Ctrl-O to use a file browser). Now you can edit the file then use buttons in the page header to Save / Run / Preview its content or result according to the document type: Script / HTML or Markdown.

Beyond this basic editor usage, **nodEdit** provides some additional functions.
To be mentioned:

- **Javascript** list of functions and variables with their associated comments (a la JSDoc) with *goto line* number on click
- **Markdown** formatting keyboard shortcuts (or menu entries) for *Bold*, *Italic*, *Web link*, *List*, and so on&hellip;

##Status
Experimental

##Credit and Web References

- [Install and use a third party NodejJS module](https://github.com/appjs/appjs/wiki/Install-and-use-a-third-party-nodejs-module)
- [Getting started with Yeoman](https://github.com/yeoman/yeoman/wiki/Getting-Started)
- [Transfer objects between window and node](https://github.com/rogerwang/node-webkit/wiki/Transfer-objects-between-window-and-node)
- [node-webkit - Download](https://github.com/rogerwang/node-webkit#downloads)
- [node-webkit - Manifest format](https://github.com/rogerwang/node-webkit/wiki/Manifest-format)
- [node-webkit - Native UI API Manual](https://github.com/rogerwang/node-webkit/wiki/Native-UI-API-Manual#menus)
- [CodeMirror 3 - User manual and reference guide](http://codemirror.net/2/doc/manual.html)
- [Emmet - Zen Coding HTML abbreviations syntax](http://docs.emmet.io/abbreviations/syntax/)
- [hljs - How to use highlight.js](http://highlightjs.org/usage/)
- [Animate.CSS - Just-add-water CSS animations](http://daneden.github.io/animate.css/)
- [Google Fonts - Google Developers](https://developers.google.com/fonts/docs/getting_started)
