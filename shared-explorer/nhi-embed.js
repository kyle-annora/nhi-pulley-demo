// NHI-owned shell presentation. Public commands remain the only host control.
if(new URLSearchParams(location.search).get('host')==='nhi')document.documentElement.dataset.host='nhi';
