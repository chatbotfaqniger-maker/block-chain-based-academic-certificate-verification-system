self.addEventListener("push",event=>{
 let data={title:"VERITY",body:"You have a new update.",url:"/"};
 try{if(event.data)data={...data,...event.data.json()};}catch{}
 event.waitUntil(self.registration.showNotification(data.title||"VERITY",{body:data.body||"You have a new update.",tag:"verity-update",data:{url:data.url||"/"}}));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const target=new URL(event.notification.data?.url||"/",self.location.origin).href;
 event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
  for(const client of list){if(new URL(client.url).origin===self.location.origin){client.navigate(target);return client.focus();}}
  return clients.openWindow(target);
 }));
});
