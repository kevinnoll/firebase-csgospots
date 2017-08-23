const functions = require('firebase-functions');
const gcs = require("@google-cloud/storage")();
const admin = require('firebase-admin');
const fs = require('fs');
const cors = require('cors')({origin: true});
const statistics = {};

admin.initializeApp(functions.config().firebase);

exports.dev_migrateSpotsToSearch = functions.https.onRequest((req, res) => {
	
		if (req.method !== 'GET') {
			res.status(403).send('Forbidden!');
		}
	
		cors(req, res, () => {
			var refSpot = admin.database().ref("/spots");
			var refSearch = admin.database().ref("/search");
			
			refSpot.once('value').then(snap => {
				if (!snap.exists()) {
					res.status(200).send("No data");
					return;
				}

				let spots = snap.val();
				let debug_msgs = [];
				let searchEntries = {};
				for (let i_map in spots) {
					for (let i_strat in spots[i_map]) {
						for (let i_key in spots[i_map][i_strat]) {
							let spot = spots[i_map][i_strat][i_key];
							let relValues = [];	
							relValues.push(spot.mapName);
							relValues.push(spot.strategy);
							relValues.push(spot.displayName);
							relValues.push(spot.title);
							searchEntries[i_key] = {
								d: relValues.join(" "),
								title : spot.title,
								mapName: spot.mapName,
								strategy: spot.strategy
							}
							debug_msgs.push(i_key);
						}
					}
				}
				refSearch.update(searchEntries);
				res.status(200).send("migration successful for: " + debug_msgs.join(","));
			});
		});	
	})

exports.search = functions.https.onRequest((req, res) => {

	if (req.method !== 'GET') {
		res.status(403).send('Forbidden!');
	}

	cors(req, res, () => {
		var words = req.query["s"].split(" ");

		var ref = admin.database().ref("/search");
		ref.once('value').then(snap => {
			if (!snap.exists()) {
				res.status(200).send("No data");
				return;
			}

			let candidates = snap.val(), i_word = 0;
			while (candidates !== {} && i_word < words.length) {
				for (var i in candidates) {
					if (candidates[i].d.indexOf(words[i_word]) < 0) {
						delete candidates[i];
					}
				}
				i_word++;
			}

			// maybe consider ratings when valuating results
			res.status(200).send(JSON.stringify(candidates));
		});
	});	
})

exports.processNewUser = functions.database.ref('/tempuser/{pushId}')
	.onCreate(event => {
		console.log('received new user request');
		const user = event.data.val();
		const key = event.data.key;
		const promises = [];

		promises.push(createDisplayName());
		promises.push(createUid());
		promises.push(createUidEmail());

		Promise.all(promises).then((a,b,c) => {
			admin.database().ref(`/tempuser/${key}`).remove();
		})

		// insert user to displayNames 
		function createDisplayName() {
			let o = {};
			o[user.displayName] = {
				uid : user.uid
			};
			return admin.database().ref('displayNames/').update(o);
		}

		function createUid() {
			let o = {};
			o[user.uid] = {
				displayName : user.displayName
			};
			return admin.database().ref('uids/').update(o);
		}

		function createUidEmail() {
			let o = {};
			o[user.uid] = {
				email : user.email
			};
			return admin.database().ref('uidEmail/').update(o);
		}
		
	})

exports.processNewSpot = functions.database.ref('/temp/{pushId}')
	.onCreate(event => {
		const post = event.data.val();
		const key = event.data.key;
		var sKey = makeid();

		readKey();

		function readKey () {
			console.log("checking if there is already a key named " + sKey);
			return admin.database().ref(`spotids/${sKey}`).once('value').then(snap => {
				if(snap.val() === null) {
					console.log("found an unused key, it is: " + sKey)
					processSpot();
					return sKey;
				} else {
					console.log("key " + sKey + " already in use, getting a new one.")
					sKey = makeid();
					console.log("new key is: " + sKey);
					readKey();
				}
			})
		}

		function processSpot() {
			// validation
			if ( !post.strategy || !post.title || !post.mapname) {
				console.log("no strategy/title/map provided");
				return;
			} else {
				if ( post.strategy === "smoke" || post.strategy === "decoy" || post.strategy === 'brand') {
					processVideoSpot();
				}
				if ( post.strategy === "spot" || post.strategy === "awp") {
					processPictureSpot();
				}
			}
		}

		// insert spotid data and use it as inversed key
		function createSpotId() {
			let o = {};
			o[sKey] = {
				mapName : post.mapname,
				strategy : post.strategy
			};
			return admin.database().ref('spotids/').update(o);
		}

		// persist to spot data
		function createSpot() {
			let spot = {};
			spot[sKey] = {
				date : admin.database.ServerValue.TIMESTAMP,				
				title : post.title,
				mapName : post.mapname,
				strategy : post.strategy,
				videoId : post.videoId || null,
				startSeconds : post.startSeconds || null,
				endSeconds : post.endSeconds || null,
				picture_1 : post.picture_1 || null,
				picture_2 : post.picture_2 || null,
				picture_3 : post.picture_3 || null,
				displayName : post.displayName || null
			}
			return admin.database().ref('spots/' + post.mapname + '/' + post.strategy + '/')
				.update(spot);
		}

		// persist to location data
		function createLocation() {
			let location = {};
			location[sKey] = {
				start : post.start,
				strategy : post.strategy,
				end : post.end || null,
				angle : (post.strategy === 'spot' || post.strategy === 'awp') ? post.angle : null
			}
			return admin.database().ref('locations/' + post.mapname + '/' + post.strategy + '/')
				.update(location);
		}

		function createStatistics () {
			return admin.database().ref(`statistics/${post.mapname}/${post.strategy}`).once('value').then(function(snapshot) {
				let k = snapshot.val() || {};
				if (k.value) {
					k.value++;
				} else {
					k.value = 1
				}
				
				return admin.database().ref(`statistics/${post.mapname}/${post.strategy}`).update(k).then(snap => {
					console.log("updated statistics")
				})
			});
		}

		function createSearchEntry () {
			let o = {};	
			let relValues = [];	
			relValues.push(post.mapName);
			relValues.push(post.strategy);
			relValues.push(post.displayName);
			relValues.push(post.title);
			o[sKey] = {
				d: relValues.join(" "),
				title : post.title,
				mapName: post.mapName,
				strategy: post.strategy
			}
			return admin.database().ref('search/')
				.update(o);
		}

		// add usernode with spotids below
		function createUserSpotMapping () {
			let o = {};
			o[sKey] = {
				date : admin.database.ServerValue.TIMESTAMP,
				strategy : post.strategy,
				mapname : post.mapname,
				title : post.title
			};
			return admin.database().ref(`userSpot/${post.uid}/spots/`).update(o);
		}

		function createUserStatistics () {
			return admin.database().ref(`userSpot/${post.uid}/statistic/${post.strategy}`).once('value').then(function(snapshot) {
				let k = snapshot.val() || {};
				if (k.value) {
					k.value++;
				} else {
					k.value = 1
				}
				
				console.log("k is " + JSON.stringify(k));
				console.log(`writing a ${k.value} to userSpot/${post.uid}/statistic/${post.strategy}`);
				return admin.database().ref(`userSpot/${post.uid}/statistic/${post.strategy}`).update(k).then(snap => {
					console.log("updated userstatstics")
				})
			});
		}

		function processVideoSpot () {
			if (!post.videoId  || !post.endSeconds) {
				console.log("no videoId or valid endtime provided for smoke/decoy")
				return;
			} 
			console.log("data seems fine, going in!");

			let aPromises = [];
			aPromises.push(createSpotId());
			aPromises.push(createSpot());
			aPromises.push(createLocation());
			aPromises.push(createStatistics());
			aPromises.push(createUserSpotMapping());
			aPromises.push(createUserStatistics());
			aPromises.push(createSearchEntry());

			// cleanup tmp folder
			Promise.all(aPromises).then((a,b,c,d,e,f,g) => {
				console.log("all 6 (+ 1 search) pushed successfully");
				admin.database().ref(`temp/${key}`).remove();
			})
		}

		function processPictureSpot () {
			if (post.angle < 0 || post.angle > 360) {
				console.log("wrong angle provider for awp/spot")
				return;
			}
			if (post.picture_1 === "" && post.picture_2 === "" && post.picture_3 === "") {
				console.log("no picture path provided")
				return;
			}
			if (post.picture_1 !== "" && !post.picture_1.startsWith("http://i.imgur.com/")) {
				console.log("picture 1 not hosted at imgur");
				return;
			}
			if (post.picture_2 !== "" && !post.picture_2.startsWith("http://i.imgur.com/")) {
				console.log("picture 2 not hosted at imgur");
				return;
			}
			if (post.picture_3 !== "" && !post.picture_3.startsWith("http://i.imgur.com/")) {
				console.log("picture 3 not hosted at imgur");
				return;
			}
			console.log("data seems fine, going in!");

			let aPromises = [];
			aPromises.push(createSpotId());
			aPromises.push(createSpot());
			aPromises.push(createLocation());
			aPromises.push(createStatistics());			
			aPromises.push(createUserSpotMapping());
			aPromises.push(createUserStatistics());
			aPromises.push(createSearchEntry());

			// cleanup tmp folder
			Promise.all(aPromises).then((a,b,c,d,e,f,g) => {
				console.log("all 6 (+ 1 search) pushed successfully");
				admin.database().ref(`temp/${key}`).remove();
			})
		} 

		function makeid() {
			var text = "";
			var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

			for( var i=0; i < 5; i++ ) {
				text += possible.charAt(Math.floor(Math.random() * possible.length));
			}	
			return text;
		}
	})
