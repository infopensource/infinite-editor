"""Run the HTML fixture printed by `npm run test:zoom-browser` in desktop WebKit.
Usage: python3 scripts/test-zoom-webkit.py file:///tmp/infinite-pagination-.../test.html
Requires PyGObject, GTK 3, WebKit2GTK 4.1 and a graphical session.
"""
import gi,json,sys
gi.require_version('Gtk','3.0')
gi.require_version('WebKit2','4.1')
from gi.repository import Gtk,WebKit2,GLib
window=Gtk.Window()
window.set_default_size(1000,1000)
view=WebKit2.WebView()
window.add(view)
window.show_all()
view.load_uri(sys.argv[1])
status=1
def done(view,result,*args):
 global status
 try:
  value=view.evaluate_javascript_finish(result).to_string()
  if value:
   print(value,flush=True)
   status=0 if json.loads(value)['ok'] else 1
   Gtk.main_quit()
 except Exception as error:
  print(error,flush=True)
def poll():
 view.evaluate_javascript('document.getElementById("result")?.textContent || ""',-1,None,None,None,done,None)
 return True
GLib.timeout_add(500,poll)
GLib.timeout_add_seconds(15,lambda: (Gtk.main_quit(),False)[1])
Gtk.main()
sys.exit(status)
