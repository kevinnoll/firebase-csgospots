const functions = require('firebase-functions');
const gcs = require("@google-cloud/storage")();
const admin = require('firebase-admin');
const fs = require('fs');
const cors = require('cors')({ origin: true });
const statistics = {};

admin.initializeApp(functions.config().firebase);

exports.dev_migrateSpotsToFlat = functions.https.onRequest((req, res) => {

	if (req.method !== 'GET') {
		res.status(403).send('Forbidden!');
	}

	cors(req, res, () => {
		var refSpot = admin.database().ref("/spots");
		var refFSpot = admin.database().ref("/fspots");
		var refMenu = admin.database().ref("/menu");
		var refLoc = admin.database().ref("/locations")

		refLoc.once('value').then((snapLocs) => {
			let locs = snapLocs.val();
			refSpot.once('value').then(snap => {
				if (!snap.exists()) {
					res.status(200).send("No data");
					return;
				}
				let menu = {};
				let spots = snap.val();
				let debug_msgs = [];
				let fspots = {};
				for (let i_map in spots) {
					for (let i_strat in spots[i_map]) {
						for (let i_key in spots[i_map][i_strat]) {
							let spot = spots[i_map][i_strat][i_key];
							spot.id = i_key;
							spot.path = i_map + "/" + i_strat;

							let loc = locs[i_map][i_strat][i_key];
							if (!!loc.angle) {
								spot.start = loc.start;
								spot.angle = loc.angle;
							} else {
								spot.start = loc.start;
								spot.end = loc.end;
							}

							// build menu structure
							if (i_map in menu) {
								if (i_strat in menu[i_map]) {
									menu[i_map][i_strat]++;
								} else {
									menu[i_map][i_strat] = 1;
									//menu[i_map]["type"] = i_map.split("_")[0]; // takes de from de_dust2
								}
							} else {
								menu[i_map] = {};
								menu[i_map][i_strat] = 1;
								//menu[i_map]["type"] = i_map.split("_")[0];
							}

							spot.rating = 0;
							fspots[i_key] = spot;
							debug_msgs.push(i_key);
						}
					}
				}
				refMenu.update(menu);
				refFSpot.update(fspots);
				res.status(200).send("migration successful for: " + debug_msgs.join(","));
			});
		});
	});
})

exports.search = functions.https.onRequest((req, res) => {

	if (req.method === 'PUT') {
		res.status(403).send('Forbidden!');
	}

	let relevantAttributes = [
		"title",
		"mapName",
		"strategy",
		"displayName"
	];

	cors(req, res, () => {
		var words = req.query["s"].split(" ");

		var ref = admin.database().ref("/fspots");
		ref.once('value').then(snap => {
			if (!snap.exists()) {
				res.status(200).send("No data");
			}

			let candidates = snap.val(), i_word = 0;
			while (candidates !== {} && i_word < words.length) {
				for (var i in candidates) {
					let hit = false;
					for (var r in relevantAttributes) {
						if (candidates[i][relevantAttributes[r]].indexOf(words[i_word]) >= 0) {
							hit = true;
							break;
						}
					}
					if (!hit) {
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

		promises.push(createUid());

		Promise.all(promises).then((a) => {
			admin.database().ref(`/tempuser/${key}`).remove();
		});		

		function createUid() {
			let o = {};
			o[user.uid] = {
				email: user.email,
				displayName: user.displayName
			};
			return admin.database().ref('uids/').update(o);
		}

	})

exports.processNewSpot = functions.database.ref('/temp/{pushId}')
	.onCreate(event => {
		const post = event.data.val();
		const key = event.data.key;
		var sKey = makeid();

		readKey();

		function readKey() {
			console.log("checking if there is already a key named " + sKey);
			return admin.database().ref(`fspots/${sKey}`).once('value').then(snap => {
				if (snap.val() === null) {
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
			if (!post.strategy || !post.title || !post.mapname) {
				console.log("no strategy/title/map provided");
				return;
			} else {
				if (post.strategy === "smoke" || post.strategy === "decoy" || post.strategy === 'brand') {
					processVideoSpot();
				}
				if (post.strategy === "spot" || post.strategy === "awp") {
					processPictureSpot();
				}
			}
		}

		// persist to spot data
		function createSpot() {
			let spot = {
				id: sKey,
				date: admin.database.ServerValue.TIMESTAMP,
				title: post.title,
				mapName: post.mapname,
				strategy: post.strategy,
				videoId: post.videoId || null,
				startSeconds: post.startSeconds || null,
				endSeconds: post.endSeconds || null,
				picture_1: post.picture_1 || null,
				picture_2: post.picture_2 || null,
				picture_3: post.picture_3 || null,
				displayName: post.displayName || null,
				path: "unpublished",
				published: false,
				rating : 0,
				start : post.start,
				end: post.end,
				angle: (post.strategy === 'spot' || post.strategy === 'awp') ? post.angle : null
			}			

			return admin.database().ref('/fspots/' + sKey)
				.set(spot);
		}		

		function processVideoSpot() {
			if (!post.videoId || !post.endSeconds) {
				console.log("no videoId or valid endtime provided for smoke/decoy")
				return;
			}
			console.log("data seems fine, going in!");

			let aPromises = [];
			aPromises.push(createSpot());

			// cleanup tmp folder
			Promise.all(aPromises).then((a) => {
				console.log(" pushed successfully");
				admin.database().ref(`temp/${key}`).remove();
			})
		}

		function processPictureSpot() {
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
			aPromises.push(createSpot());

			// cleanup tmp folder
			Promise.all(aPromises).then((a) => {
				console.log("pushed successfully");
				admin.database().ref(`temp/${key}`).remove();
			})
		}

		function makeid() {
			var text = "";
			var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

			for (var i = 0; i < 5; i++) {
				text += possible.charAt(Math.floor(Math.random() * possible.length));
			}
			return text;
		}
	})
