// Fitur tambahan (client-side). Diserialisasi via toString() supaya escape aman.
function __featuresMain(){
  var LS = window.localStorage;
  function gv(k,d){ try{ var v=LS.getItem(k);