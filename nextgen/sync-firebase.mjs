const sdk='https://www.gstatic.com/firebasejs/11.10.0/';
const config={
  apiKey:'AIzaSyD9SitT1eLpmWDp-c4HQEfUeWzo-yQMeYc',
  authDomain:'workie-gen-2-8e549.firebaseapp.com',
  projectId:'workie-gen-2-8e549',
  storageBucket:'workie-gen-2-8e549.firebasestorage.app',
  messagingSenderId:'333743398132',
  appId:'1:333743398132:web:45d930656c4f6b2e7192a1',
};

// Release gate. Enable only after approved Rules deployment and verification.
export const writesEnabled=true;
export async function loadFirebase() {
  const [core,auth,firestore]=await Promise.all([
    import(sdk+'firebase-app.js'),import(sdk+'firebase-auth.js'),import(sdk+'firebase-firestore.js'),
  ]);
  const app=core.initializeApp(config,'workie-gen2-sync');
  const session=auth.getAuth(app);
  await auth.setPersistence(session,auth.browserLocalPersistence);
  const db=firestore.getFirestore(app);
  const path=uid=>firestore.doc(db,'users',uid,'workieSync','head');
  return {
    observe:callback=>auth.onAuthStateChanged(session,callback),
    signIn:()=>auth.signInWithPopup(session,new auth.GoogleAuthProvider()),
    signOut:()=>auth.signOut(session),
    transport(uid) {
      const ref=path(uid);
      const requireOwner=()=>{
        if(session.currentUser?.uid!==uid)throw Error('The Google account changed. Reopen Sync and handoff.');
      };
      const unpack=snapshot=>{
        if(!snapshot.exists())return null;
        const {payload,updatedAt,...head}=snapshot.data();
        if(!(payload instanceof firestore.Bytes)||!updatedAt)throw Error('Cloud snapshot has invalid metadata.');
        return {...head,payload:new TextDecoder('utf-8',{fatal:true}).decode(payload.toUint8Array())};
      };
      return {
        owner:config.projectId+'/'+uid,
        async read(){requireOwner();return unpack(await firestore.getDocFromServer(ref));},
        async write(expected,head,fresh) {
          if(!writesEnabled)throw Error('Cloud writes are disabled pending Security Rules verification.');
          await firestore.runTransaction(db,async transaction=>{
            requireOwner();
            const current=unpack(await transaction.get(ref));
            if((current?.revision??0)!==expected.revision||current?.checksum!==expected.checksum||
              current?.operationId!==expected.operationId)throw Error('The cloud changed. Review sync again.');
            await fresh();requireOwner();
            transaction.set(ref,{...head,payload:firestore.Bytes.fromUint8Array(new TextEncoder().encode(head.payload)),
              updatedAt:firestore.serverTimestamp()});
          });
        },
        listen(callback,error) {
          requireOwner();
          return firestore.onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
            if(!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites)callback(snapshot.data()?.revision??0);
          },error);
        },
      };
    },
  };
}
