const functions = require('firebase-functions');
const gcs = require("@google-cloud/storage")();
const admin = require('firebase-admin');
const fs = require('fs');
const cors = require('cors')({origin: true});
const statistics = {};

admin.initializeApp(functions.config().firebase);

exports.test = functions.https.onRequest((request, response) => {
	console.log("TEST : " + gcs.bucket("/spots/de_dust2/smoke"))
	//const blob = gcs.bucket("/spots/de_dust2/smoke").file("knecht.json").createWriteStream();
  	//const blobStream = blob.createWriteStream()
	/*fs.writeFile('/hi/myjsonfile.json', JSON.stringify({mapname:"test",title:"rippler"}), 'utf8', function (arg) {
		console.log("it called me back; " + arg.toString())
	});*/
	var fs = require('fs');
    fs.writeFile("thing.json", JSON.stringify({mapname:"test",title:"rippler"}));

	let bucket = gcs.bucket("csgospots-1f294").upload('thing.json', function(err, file, apiResponse) {
		console.log("err: " + err.toString());
		console.log("file: " + file.toString());
		console.log("api: " + apiResponse.toString());
		response.send("finito");

	// Your bucket now contains:
	// - "image.png" (with the contents of `/local/path/image.png')

	// `file` is an instance of a File object that refers to your new file.
	});
		/*console.log("bucket: " + bucket.toString());
		bucket.file("blyat").save("alsdoalsdoasld").then(function(){
			console.log("seems saved");
		},function(err){
			console.log(err.toString())
		})*/

	/*let myBucket = gcs.bucket().get().then(function (data){
		console.log("then erreicht")
		console.log("data: " + data.toString());
		myBucket.file('my-file').save({mapname:"test",title:"rippler"});

		response.send("finito");
		return
	});*/
});

exports.processNewSpot = functions.database.ref('/temp/{pushId}')
	.onWrite(event => {
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
			if (!post.videoId || !post.title || !post.endSeconds || !post.endSeconds) {
				console.log("too less data to insert");
				return;
			} 

			let o = {},
				aPromises = [];
			o[sKey] = true;
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
				published : false
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

			// increase counter
			aPromises.push(admin.database().ref('statistics/' + post.mapname + '/' + post.strategy + '/').once('value').then(function(snapshot) {
				let count = 1;
				if (snapshot.val() !== null && !!snapshot.val().count) {
					count = snapshot.val().count++;
				}
				return admin.database().ref('statistics/' + post.mapname + '/' + post.strategy + '/').update({count:count}).then(snap => {
					console.log("updated statistics")
				})
			}));

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
