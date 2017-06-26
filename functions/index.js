const functions = require('firebase-functions');

const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
exports.getUniqueId = functions.https.onRequest((request, response) => {
	var sKey = makeid();

	readKey();

	function readKey () {
		console.log("checking if there is already a key named " + sKey);
		return admin.database().ref(`spots/${sKey}`).once('value').then(snap => {
			if(snap.val() === null) {
				console.log("found an unused key, it is: " + sKey)
				insertKey();
				response.send(sKey);
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
		o[sKey] = 0;
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
