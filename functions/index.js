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
					insertKey();
					return sKey;
				} else {
					console.log("key " + sKey + " already in use, getting a new one.")
					sKey = makeid();
					console.log("new key is: " + sKey);
					readKey();
				}
			})
		}

		function insertKey() {
			// validation
			if ( !post.strategy || !post.title || !post.mapname) {
				console.log("no strategy/title/map provided");
				return;
			} else {
				if ( post.strategy === "smoke" || post.strategy === "decoy") {
					if (!post.videoId  || !post.endSeconds) {
						console.log("no videoId or valid endtime provided for smoke/deocy")
						return;
					} 
				}
				if ( post.strategy === "spot" || post.strategy === "awp") {
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
				}
			}
			console.log("data seems fine, going in!");

			// insert spotid data and use it as inversed key
			let o = {},
				aPromises = [];
			o[sKey] = {
				mapName : post.mapname,
				strategy : post.strategy
			};
 			aPromises.push(admin.database().ref('spotids/').update(o));
			
			// persist to spot data
			let spot = {};
			spot[sKey] = {
				videoId : post.videoId,
				title : post.title,
				startSeconds : post.startSeconds,
				endSeconds : post.endSeconds,
				mapName : post.mapname,
				strategy : post.strategy,
				published : false
			}
			aPromises.push(admin.database().ref('spots/' + post.mapname + '/' + post.strategy + '/')
				.update(spot));

			// persist to location data
			let location = {};
			location[sKey] = {
				start : post.start,
				end : post.end,
				published : false,
				angle : 0
			}
			aPromises.push(admin.database().ref('locations/' + post.mapname + '/' + post.strategy + '/')
				.update(location));

			// persist to release data
			// we do this to save runtime. we could also run over every deep node
			// like /de_dust2/smoke/xxxxx.json and filter for a published=false flag,
			// but we would need to do this for every path which would also need
			// further customizing if more maps get released.
			let releaseCandidate = {}
			releaseCandidate[sKey] = Object.assign(post,{spotId:sKey});
			aPromises.push(admin.database().ref('releaseCandidates/')
				.update(releaseCandidate));

			// cleanup tmp folder
			Promise.all(aPromises).then((a,b,c) => {
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
