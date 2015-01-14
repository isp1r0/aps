var Hapi = require('hapi'),
    Path = require('path'),
    settings = require('./server/config/settings'),
    utils = require('./server/common/utils.js'),
    Nunjucks = require('hapi-nunjucks'),
    _ = require('underscore');

require('pretty-error').start();
require('colors');


// 1. Create a server with the host, port, and options defined in the main server's settings file
var server = new Hapi.Server(settings.serverOptions);
server.connection({
    host: settings.host,
    port: settings.port
});

// 2. Configure views
server.views(settings.viewsOptions);

Nunjucks.configure(Path.join(settings.rootPath, 'server/views'), {
    watch: true
    //    autoescape: true 
});

Nunjucks.addGlobal("lang", "pt");


// 3. Register the plugins
utils.registerPlugins(server);


// 4. Add the various routes; add the pre-requisite methods to each route
//require('./server/config/addPrerequisites.js')(routeTable);

// add the routes to the server
server.route(require('./server/routes/assetsRoutes.js'));
server.route(require('./server/routes/baseRoutes.js'));


// 5. Add the API routes

// read every module in the api directory (in server/api/index.js, require-directory is used to read 
// all the files in the directory); this will create an object of modules
var apiRoutesArray = _.values(require("./server/api"));

// register the API routes (defined in separate modules as hapi plugin objects)
server.register(
    apiRoutesArray, 
    {
        routes: {
            prefix: "/api"
        }
    },
    function(err) {
        if (err) {
            throw err;
        }
    }
);



/*


server.ext('onRequest', function (request, next) {

    var routePath = request.path,
        toExclude = ["partials", "images", "css", "fonts", "js"];

	var showMessage = true;

    for(var i=0, l=toExclude.length; i<l; i++){
        if(routePath.indexOf(toExclude[i]) >= 0){ showMessage = false; }
    }

    if(showMessage){
		console.log("-------------- begin request ---------------");
		console.log("			onRequest (path: " + request.path + ", method: " + request.method + " )");
    }

	next();
});
server.ext('onPreAuth', function (request, next) {
    var routePath = request.path,
        toExclude = ["partials", "images", "css", "fonts", "js"];

	var showMessage = true;

    for(var i=0, l=toExclude.length; i<l; i++){
        if(routePath.indexOf(toExclude[i]) >= 0){ showMessage = false; }
    }

    if(showMessage){
		console.log("			onPreAuth (path: " + request.path + ", method: " + request.method + " )");
    }

	next();
});

*/


// 5. Start the server
server.start(function() {
    console.log("Server started: \n" +
        "    protocol:".blue + " " + server.info.protocol + "\n" +
        "    host:".blue + " " + server.info.host + "\n" +
        "    port:".blue + " " + server.info.port + "\n" +
        "    uri:".blue + " " + server.info.uri + "\n" +
        "    address:".blue + " " + server.info.address);

});

var ent = require("ent");
console.log(ent.decode("OBSERVAT&Oacute;RIO DE CLIMA E CEN&Aacute;RIOS CLIM&Aacute;TICOSzz fwefw&otilde;&nbsp;"));
