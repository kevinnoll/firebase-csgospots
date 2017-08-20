const functions = require('firebase-functions');
const gcs = require("@google-cloud/storage")();
const admin = require('firebase-admin');
const fs = require('fs');
const cors = require('cors')({origin: true});
const statistics = {};

admin.initializeApp(functions.config().firebase);

exports.search = functions.https.onRequest((req, res) => {

	if (req.method !== 'GET') {
		res.status(403).send('Forbidden!');
	}

	cors(req, res, () => {
		var words =  req.query["s"].split(" ");
		// count hits for the split query string in search entity's "d"-value
		// limit search set word by word

		var ref = admin.database().ref("/search");
		ref.once('value').then(snap => {

			let candidates_before, candidates_after = snap, iter_w = 0;
			while (candidates_after.length > 0 && iter_w < words.length) {
				candidates_before = candidates_after;
				candidates_after = [];
				for (var i, len = candidates_before.length; i < len; i++) {
					if (candidates_before[i].d.indexOf(words[iter_w]) >= 0) {
						candidates_after.push(candidates_before[i]);
					}
				}
				iter_w++;
			}
			// maybe consider ratings when valuating results
			res.status(200).send(JSON.stringify(candidates_after));
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
				d: relValues.join(" ")
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
