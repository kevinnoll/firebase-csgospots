const functions = require('firebase-functions');
const gcs = require("@google-cloud/storage")();
const admin = require('firebase-admin');
const fs = require('fs');
const cors = require('cors')({origin: true});
const statistics = {};

admin.initializeApp(functions.config().firebase);

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
				if ( post.strategy === "smoke" || post.strategy === "decoy") {
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
				title : post.title,
				mapName : post.mapname,
				strategy : post.strategy,
				published : false,
				videoId : post.videoId || null,
				startSeconds : post.startSeconds || null,
				endSeconds : post.endSeconds || null,
				picture_1 : post.picture_1 || null,
				picture_2 : post.picture_2 || null,
				picture_3 : post.picture_3 || null
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
				published : false,
				angle : post.angle || 0
			}
			return admin.database().ref('locations/' + post.mapname + '/' + post.strategy + '/')
				.update(location);
		}

		// persist to release data
		// we do this to save runtime. we could also run over every deep node
		// like /de_dust2/smoke/xxxxx.json and filter for a published=false flag,
		// but we would need to do this for every path which would also need
		// further customizing if more maps get released.
		function createReleaseCandidate() {
			let releaseCandidate = {}
			releaseCandidate[sKey] = Object.assign(post,{spotId:sKey});
			return admin.database().ref('releaseCandidates/')
				.update(releaseCandidate);
		}

		function processVideoSpot () {
			if (!post.videoId  || !post.endSeconds) {
				console.log("no videoId or valid endtime provided for smoke/deocy")
				return;
			} 
			console.log("data seems fine, going in!");

			let aPromises = [];
			aPromises.push(createSpotId());
			aPromises.push(createSpot());
			aPromises.push(createLocation());
			aPromises.push(createReleaseCandidate());

			// cleanup tmp folder
			Promise.all(aPromises).then((a,b,c,d) => {
				console.log("all 4 pushed successfully");
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
			aPromises.push(createReleaseCandidate());

			// cleanup tmp folder
			Promise.all(aPromises).then((a,b,c,d) => {
				console.log("all 4 pushed successfully");
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
