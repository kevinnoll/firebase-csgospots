const functions = require('firebase-functions');
const gcs = require("@google-cloud/storage")();
const admin = require('firebase-admin');
const fs = require('fs');
const cors = require('cors')({origin: true});

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


exports.createSmoke = functions.https.onRequest((request, response) => {
	if (!request.body.mapname || 
		!request.body.title || 
		!request.body.strategy || 
		!request.body.videoId) {
			response.send("please provide more information.");
			return;
	}
	if ( typeof request.body.start.x !== "number" || typeof request.body.start.y !== "number" ||
		typeof request.body.end.x !== "number" || typeof request.body.end.y !== "number") {
			response.send("coordinates are not of type number");
			return;
	}
	if (request.body.start.x < 0 || request.body.start.x > 1024 ||
		request.body.start.y < 0 || request.body.start.y > 1024 ||
		request.body.end.x < 0 || request.body.end.x > 1024 ||
		request.body.end.y < 0 || request.body.end.y > 1024) {
			response.send("coordinates are not in the correct range");
			return;
	}

	let oSpot = request.body;

	let sKey = "aEv8v",
		sBucket = "/spots/" + oSpot.mapname + "/" + oSpot.strategy + "/",
		oBucket = gcs.bucket(sBucket);


	/*oBucket.upload(tempFilePath, {
      destination: thumbFilePath
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

			let location = {};
			location[sKey] = {
				start : post.start,
				end : post.end,
				published : false
			}
			aPromises.push(admin.database().ref('locations/' + post.mapname + '/' + post.strategy + '/')
				.update(location));
			
			/*Promise.all(aPromises).then((a,b,c) => {
				console.log("all 3 pushed successfully");
				admin.database().ref(`temp/${key}`).remove();
			})*/
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


// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.getUniqueId = functions.https.onRequest((request, response) => {
	cors(request, response, () => {

		var sKey = makeid();

		readKey();

		if (!request.body.mapname || !request.body.title || !request.body.strategy) {
			response.send("please provide more information.");
			return;
		}

		function readKey () {
			console.log("checking if there is already a key named " + sKey);
			return admin.database().ref(`spots/${sKey}`).once('value').then(snap => {
				if(snap.val() === null) {
					console.log("found an unused key, it is: " + sKey)
					insertKey();
					response.status(200).send(JSON.stringify({spotId : sKey}));
				} else {
					console.log("key " + sKey + " already in use, getting a new one.")
					sKey = makeid();
					console.log("new key is: " + sKey);
					readKey();
				}
			})
		}

		function insertKey() {
			var o = {}
			o[sKey] = request.body;
			o[sKey].votes = 0;
			admin.database().ref('spots/').update(o).then(snap => {
				console.log("set data complete")
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

  	});

});
