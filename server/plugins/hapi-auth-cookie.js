// PLUGIN: Hapi Auth Cookie

// Cookie authentication provides a simple cookie-based session management.
// https://github.com/hapijs/hapi-auth-cookie

module.exports = function registerHapiAuthCookie(server){

    server.register(
        {
            register: require('hapi-auth-cookie'),
            options: {}
        }, 
        function (err) {

            if (err){ throw err; }

            console.log("plugin registered: hapi-auth-cookie");

            // 12 * 60 * 60 * 1000 = 12 hours
            var cache = server.cache({ segment: 'sessions',  expiresIn: 12 * 60 * 60 * 1000 });
            server.app.cache = cache;

            server.auth.strategy('session', 'cookie', true, {
                password: 'jfuiewbfuiwebw',
                cookie: 'sid',
//              redirectTo: '/xyz',  // if authentication fails, redirect; if not set, will simply return a forbidden message
//                redirectOnTry: false,
                isSecure: false,
                clearInvalid: true,  // if the session is expired, will delete the cookie in the browser (but if the cookie has expired, it will remain)
                validateFunc: function (session, callback) {
debugger;
                    cache.get(session.sid, function (err, cached) {
debugger;
                        if (err) {
                            console.log("    validateFunc @ hapi-auth-cookie: error to get data from catbox".red);
                            return callback(err, false);
                        }

                        if (!cached) {
                            console.log("    validateFunc @ hapi-auth-cookie: received cookie but it's invalid. Authentication failed.".red);
                            return callback(null, false);
                        }

                        console.log("    validateFunc @ hapi-auth-cookie: received valid cookie. Authentication succeeded.".green);
                        return callback(null, true, cached.account)
                    })
                }
            });

        }
    );


};


