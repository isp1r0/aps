/*

	API:

    var postgrator = require('postgrator');

    postgrator.setConfig({
        driver: 'pg', // or pg.js, mysql, mssql, tedious
        migrationDirectory: '',
        logProgress: true,
        host: '',
        database: '',
        username: '',
        password: ''
    });

    postgrator.migrate(version, function (err, migrations) {
        // handle the error, and if you want end the connection
        postgrator.endConnection();
    });


	NOTES:

	If schemaversion table is not present, it will be created automatically!
	If no migration version is supplied, no migration is performed

	THINGS TO IMPLEMENT SOMEDAY (MAYBE)

	postgrator.migrate('max', callback); 	// migrate to the latest migration available
	postgrator.config.tableVersionName  	// not everyone will want a table called "schemaversion"

================================================================= */

var fs = require('fs');
var crypto = require('crypto');


var createCommonClient = function (config) {

    var supportedDrivers = ['pg'];

    if (supportedDrivers.indexOf(config.driver) === -1) {
        throw new Error("db driver is not supported. Must either be " + supportedDrivers.join(" or ") + ".");
    }

    var commonClient = {
        connected: false,
        dbDriver: null,
        dbConnection: null,
        createConnection: function () {},
        runQuery: function (query, cb) {
            cb();
        },
        endConnection: function (cb) {
            cb();
        },
        queries: {
            getCurrentVersion: 'SELECT version FROM schemaversion ORDER BY version DESC LIMIT 1',
            checkTable: "",
            makeTable: ""
        }
    };

    if (config.driver == 'mysql') {

        commonClient.dbDriver = require('mysql');

        commonClient.queries.checkTable = "SELECT * FROM information_schema.tables WHERE table_schema = '" + config.database + "' AND table_name = 'schemaversion';";
        commonClient.queries.makeTable = "CREATE TABLE schemaversion (version INT, PRIMARY KEY (version)); INSERT INTO schemaversion (version) VALUES (0);";

        commonClient.createConnection = function (cb) {
            var connection = commonClient.dbDriver.createConnection({
                multipleStatements: true,
                host: config.host,
                user: config.username,
                password: config.password,
                database: config.database
            });
            commonClient.dbConnection = connection;
            connection.connect(cb);
        };

        commonClient.runQuery = function (query, cb) {
            commonClient.dbConnection.query(query, function (err, rows, fields) {
                if (err) {
                    cb(err);
                } else {
                    var results = {};
                    if (rows) results.rows = rows;
                    if (fields) results.fields = fields;
                    cb(err, results);
                }
            });
        };

        commonClient.endConnection = function (cb) {
            commonClient.dbConnection.end(cb);
        };


    } else if (config.driver === 'pg' || config.driver === 'pg.js') {

        commonClient.dbDriver = require('pg');

        var connectionString = config.connectionString || "tcp://" + config.username + ":" + config.password + "@" + config.host + "/" + config.database;

        commonClient.queries.checkTable = "SELECT * FROM pg_catalog.pg_tables WHERE schemaname = CURRENT_SCHEMA AND tablename = 'schemaversion';";
        commonClient.queries.makeTable = "CREATE TABLE schemaversion (version INT PRIMARY KEY, name TEXT DEFAULT '', md5 TEXT DEFAULT ''); INSERT INTO schemaversion (version, name, md5) VALUES (0, '', '');";

        commonClient.createConnection = function (cb) {
            commonClient.dbConnection = new commonClient.dbDriver.Client(connectionString);
            commonClient.dbConnection.connect(function (err) {
                cb(err);
            });
        };

        commonClient.runQuery = function (query, cb) {
            commonClient.dbConnection.query(query, function (err, result) {
                cb(err, result);
            });
        };

        commonClient.endConnection = function (cb) {
            commonClient.dbConnection.end();
            process.nextTick(cb);
        };

    } else if (config.driver == 'mssql' || config.driver == 'tedious') {

        commonClient.dbDriver = require('mssql');
        
        var oneHour = 1000 * 60 * 60;
        
        var sqlconfig = {
            user: config.username,
            password: config.password,
            server: config.host,
            database: config.database,
            options: config.options,
            requestTimeout: oneHour
        };

        commonClient.queries.getCurrentVersion = 'SELECT TOP 1 version FROM schemaversion ORDER BY version DESC';
        commonClient.queries.checkTable = "SELECT * FROM information_schema.tables WHERE table_schema = 'dbo' AND table_name = 'schemaversion'";
        commonClient.queries.makeTable = "CREATE TABLE schemaversion (version INT PRIMARY KEY); INSERT INTO schemaversion (version) VALUES (0);";

        commonClient.createConnection = function (cb) {
            commonClient.dbDriver.connect(sqlconfig, function (err) {
                cb(err);
            });
        };

        commonClient.runQuery = function (query, cb) {
            var request = new commonClient.dbDriver.Request();
            request.batch(query, function (err, result) {
                cb(err, {rows: result});
            });
        };

        commonClient.endConnection = function (cb) {
            // mssql doesn't offer a way to kill a single connection
            // It'll die on its own, and won't prevent us from creating additional connections.
            // eventually this should maybe use the pooling mechanism, even though we only need one connection
            cb();
        };

    } else {
        throw new Error("db driver is not supported. Must either be " + supportedDrivers.join(" or ") + ".");
    }

    return commonClient;

};

var commonClient;
var currentVersion;
var targetVersion;
var migrations = []; // array of objects like: {version: n, action: 'do', direction: 'up', filename: '0001.up.sql'}

var config = {};

exports.config = config;



/*  Set Config
================================================================= */
exports.setConfig = function (configuration) {
    config = configuration;
    commonClient = createCommonClient(configuration);
};



/*  Migration Sorting Functions
================================================================= */
var sortMigrationsAsc = function (a,b) {
	if (a.version < b.version)
		return -1;
	if (a.version > b.version)
		return 1;
	return 0;
};

var sortMigrationsDesc = function (a, b) {
	if (a.version < b.version)
		return 1;
	if (a.version > b.version)
		return -1;
	return 0;
};



/*
	getMigrations()

	Internal function
	Reads the migration directory for all the migration files.
	It is SYNC out of laziness and simplicity

================================================================= */
var getMigrations = function () {
	migrations = [];
	var migrationFiles = fs.readdirSync(config.migrationDirectory);
	migrationFiles.forEach(function(file) {
		var m = file.split('.');
		var name = m.length >= 3 ? m.slice(2, m.length - 1).join('.') : file;
		if (m[m.length - 1] === 'sql') {
			migrations.push({
				version: Number(m[0]),
				direction: m[1],
				action: m[1],
				filename: file,
				name: name,
				md5: fileChecksum(config.migrationDirectory + "/" + file)
			});
		}
	});
};


/*  runQuery
    connects the database driver if it is not currently connected.
    Executes an arbitrary sql query using the common client
================================================================= */
function runQuery (query, cb) {
	if (commonClient.connected) {
		commonClient.runQuery(query, cb);
	} else {
		// connect common client
		commonClient.createConnection(function (err) {
		    if (err) cb(err);
		    else {
		        commonClient.connected = true;
		        commonClient.runQuery(query, cb);
		    }
		});
	}
}
exports.runQuery = runQuery;


/*  endConnection
    Ends the commonClient's connection to the database
================================================================= */
function endConnection (cb) {
    if (commonClient.connected) {
        commonClient.endConnection(function () {
            commonClient.connected = false;
            cb();
        });
    } else {
        cb();
    }
}
exports.endConnection = endConnection;


/*
	getCurrentVersion(callback)

	Internal & External function
	Gets the current version of the schema from the database.

================================================================= */
var getCurrentVersion = function (callback) {
	runQuery(commonClient.queries.getCurrentVersion, function(err, result) {
		if (err) { // means the table probably doesn't exist yet. To lazy to check.
			console.error('something went wrong getting the Current Version from the schemaversion table');
		} else {
			if (result.rows.length > 0) currentVersion = result.rows[0].version;
			else currentVersion = 0;
		}
		callback(err, currentVersion);
	});
};
exports.getCurrentVersion = getCurrentVersion;



/*
	runMigrations(migrations, finishedCallback)

	Internal function
	Runs the migrations in the order provided, using a recursive kind of approach
	For each migration run:
		- the contents of the script is read (sync because I'm lazy)
		- script is run.
			if error, the callback is called and we don't run anything else
			if success, we then add/remove a record from the schemaversion table to keep track of the migration we just ran
		- if all goes as planned, we run the next migration
		- once all migrations have been run, we call the callback.

================================================================= */

var verifyChecksum = false;

var runMigrations = function (migrations, currentVersion, targetVersion, finishedCallback) {
	var runNext = function (i) {
		var sql = fs.readFileSync((config.migrationDirectory + '/' + migrations[i].filename), 'utf8');
		if (migrations[i].md5Sql) {

			if(verifyChecksum){
				console.log('verifying checksum of migration ' + migrations[i].filename);
			}

			runQuery(migrations[i].md5Sql, function (err, result) {
				if (err) {
					console.log('Error in runMigrations() while retrieving existing migrations');
					if (finishedCallback) {
						finishedCallback(err, migrations);
					}
				} else {
					if (verifyChecksum && result.rows[0].md5 && result.rows[0].md5 !== migrations[i].md5 ) {
						console.log('Error in runMigrations() while verifying checksums of existing migrations');
						if (finishedCallback) {
							finishedCallback(new Error("For migration [" + migrations[i].version + "], expected MD5 checksum [" + migrations[i].md5 + "] but got [" + result.rows[0].md5 + "]"), migrations);
						}
					} else {
						i = i + 1;
						if (i < migrations.length) {
							runNext(i);
						} else {
							if (finishedCallback) {
								finishedCallback(null, migrations);
							}
						}
					}
				}
			});
		} else {
			console.log('running ' + migrations[i].filename);
			runQuery(sql, function (err, result) {
				if (err) {
					console.log('Error in runMigrations()');
					if (finishedCallback) {
						finishedCallback(err, migrations);
					}
				} else {
					// migration ran successfully
					// add version to schemaversion table.
					runQuery(migrations[i].schemaVersionSQL, function (err, result) {
						if (err) {
							// SQL to update schemaversion failed.
							console.log('error updating the schemaversion table');
							console.log(err);
						} else {
							// schemaversion successfully recorded.
							// move on to next migration
							i = i + 1;
							if (i < migrations.length) {
								runNext(i);
							} else {
								// We are done running the migrations.
								// run the finished callback if supplied.
								if (finishedCallback) {
									finishedCallback(null, migrations);
								}
							}
						}
					});
				}
			});
		}
	};
	runNext(0);
};



/*
	.getRelevantMigrations(currentVersion, targetVersion)

	returns an array of relevant migrations based on the target and current version passed.
	returned array is sorted in the order it needs to be run

================================================================= */
var getRelevantMigrations = function (currentVersion, targetVersion) {
	var relevantMigrations = [];
	if (targetVersion >= currentVersion) {
		// we are migrating up
		// get all up migrations > currentVersion and <= targetVersion
		console.log('migrating up to ' + targetVersion);

		if(targetVersion === currentVersion){
			console.log('nothing to do. goodbye!');
		}
		migrations.forEach(function(migration) {
			if (migration.action == 'do' && migration.version > 0 && migration.version <= currentVersion && (config.driver === 'pg' || config.driver === 'pg.js')) {

				migration.md5Sql = 'SELECT md5 FROM schemaversion WHERE version = ' + migration.version + ';';

				relevantMigrations.push(migration);
			}
			if (migration.action == 'do' && migration.version > currentVersion && migration.version <= targetVersion) {
				migration.schemaVersionSQL = config.driver === 'pg' || config.driver === 'pg.js' ? "INSERT INTO schemaversion (version, name, md5) VALUES (" + migration.version + ", '" + migration.name + "', '" + migration.md5 + "');" : "INSERT INTO schemaversion (version) VALUES (" + migration.version + ");";
				relevantMigrations.push(migration);
			}
		});
		relevantMigrations = relevantMigrations.sort(sortMigrationsAsc);
	} else if (targetVersion < currentVersion) {
		// we are going to migrate down
		console.log('migrating down to ' + targetVersion);
		migrations.forEach(function(migration) {
			if (migration.action == 'undo' && migration.version <= currentVersion && migration.version > targetVersion) {
				migration.schemaVersionSQL = 'DELETE FROM schemaversion WHERE version = ' + migration.version + ';';
				relevantMigrations.push(migration);
			}
		});
		relevantMigrations = relevantMigrations.sort(sortMigrationsDesc);
	}
	return relevantMigrations;
};


/*
	.migrate(target, callback)

	Main method to move a schema to a particular version.
	A target must be specified, otherwise nothing is run.

	target - version to migrate to as string or number (will be handled as numbers internally)
	callback - callback to run after migrations have finished. function (err, migrations) {}

================================================================= */
function migrate (target, finishedCallback) {
	prep(function(err) {
		if (err) {
			if (finishedCallback) finishedCallback(err);
		}
		getMigrations();
		if (target && target === 'max') {
			targetVersion = Math.max.apply(null, migrations.map(function (migration) { return migration.version; }));
		} else if (target) {
			targetVersion = Number(target);
		}
		getCurrentVersion(function(err, currentVersion) {
			if (err) {
				console.log('error getting current version');
				if (finishedCallback) finishedCallback(err);
			} else {
				console.log('version of database is: ' + currentVersion);
				if (targetVersion === undefined) {
					console.log('no target version supplied - no migrations performed');
				} else {
					var relevantMigrations = getRelevantMigrations(currentVersion, targetVersion);
					if (relevantMigrations.length > 0) {
						runMigrations(relevantMigrations, currentVersion, targetVersion, function(err, migrations) {
							finishedCallback(err, migrations);
						});
					} else {
						if (finishedCallback) finishedCallback(err);
					}
				}
			}
		}); // get current version
	}); // prep
}
exports.migrate = migrate;


/*
	.prep(callback)

	Creates the table required for Postgrator to keep track of which migrations have been run.

	callback - function called after schema version table is built. function (err, results) {}

================================================================= */
function prep (callback) {
	runQuery(commonClient.queries.checkTable, function(err, result) {
		if (err) {
			err.helpfulDescription = 'Prep() table CHECK query Failed';
			callback(err);
		} else {
			if (result.rows && result.rows.length > 0) {
				if (config.driver === 'pg' || config.driver === 'pg.js') {
					// table schemaversion exists, does it have the md5 column? (PostgreSQL only)
					runQuery("SELECT column_name, data_type, character_maximum_length FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'schemaversion' AND column_name = 'md5';", function (err, result) {
						if (err) {
							err.helpfulDescription = 'Prep() table CHECK MD5 COLUMN query Failed';
							callback(err);
						} else {
							if (!result.rows || result.rows.length === 0) {
								// md5 column doesn't exist, add it
								runQuery("ALTER TABLE schemaversion ADD COLUMN md5 text DEFAULT '';", function (err, result) {
									if (err) {
										err.helpfulDescription = 'Prep() table ADD MD5 COLUMN query Failed';
										callback(err);
									} else {
										callback();
									}
								});
							} else {
								callback();
							}
						}
					});
				} else {
					callback();
				}
			} else {
				console.log('table schemaversion does not exist - creating it.');
				runQuery(commonClient.queries.makeTable, function(err, result) {
					if (err) {
						err.helpfulDescription = 'Prep() table BUILD query Failed';
						callback(err);
					} else {
						callback();
					}
				});
			}
		}
	});
}

/*
 .fileChecksum(filename)

 Calculate checksum of file to detect changes to migrations that have already run.

 filename - calculate MD5 checksum of contents of this file

 ================================================================= */

function fileChecksum (filename) {
	return checksum(fs.readFileSync(filename, 'utf8'));
}

function checksum (str) {
	return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}
