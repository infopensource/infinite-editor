"""Linux WebKitGTK input profile. Requires system Python GI, GTK3 and Broadway.

Builds the same editor fixture as profile-input-browser.mjs. Uses native GDK key
events; this is an isolated editor, without Dioxus/Rust integration. Optionally
check the installed Dioxus bridge encoder with --bridge-encoding /path/native.js.
That check stubs XHR and measures encoding only, not IPC or Rust handlers.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--bridge-encoding", type=Path)
parser.add_argument("--display", type=int, default=17)
parser.add_argument("--port", type=int, default=18097)
args = parser.parse_args()
output = Path(tempfile.mkdtemp(prefix="infinite-webkit-input-"))

if args.bridge_encoding:
    source = args.bridge_encoding.read_text()
    start = source.index("function handleVirtualdomEventSync(")
    encoder = source[start:source.index("function getTargetId(", start)]
    fixture = output / "encoding.html"
    fixture.write_text("<!doctype html><meta charset='utf-8'><script>" + encoder + "</script>")
    driver = """
        window.XMLHttpRequest = class {
          open() {} setRequestHeader() {} send() {}
          responseText = '{"preventDefault":false,"stopPropagation":false}';
        };
        for (const characters of [1024, 32768, 65536, 131072, 524288]) {
          const markdown = '正文内容。\\n'.repeat(Math.ceil(characters/6)).slice(0, characters);
          const payload = JSON.stringify({name:'input', element:1, bubbles:true,
            data:{value:JSON.stringify({markdown,edit_revision:1,document_revision:1}),
              values:[],valid:true}});
          const times = []; let error = null;
          for (let i=0;i<10;i++) {
            const start = performance.now();
            try { handleVirtualdomEventSync('mock://events',payload); }
            catch(caught) { error=String(caught); }
            times.push(performance.now()-start);
          }
          times.sort((a,b)=>a-b);
          send({type:'report',characters,bytes:new TextEncoder().encode(payload).length,
            p50:times[5],max:times[9],error});
        }
    """
else:
    fixture = Path(subprocess.check_output(
        ["node", "scripts/profile-input-browser.mjs", "--build-only"], text=True).strip())
    driver = """
        for (const characters of [32768,131072,524288]) {
          for (const mode of ['paged','seamless']) {
            const document = await inputProfiler.mount(characters,mode);
            for (const atEnd of [false,true]) {
              await inputProfiler.select(atEnd);
              const typing = new Promise(resolve => {window.endTyping=resolve;});
              send({type:'typing',characters,mode,atEnd});
              await typing;
              const report = await inputProfiler.report();
              if (report.inputToPaint.count !== 24) throw new Error('Expected 24 input samples, received '+report.inputToPaint.count);
              send({type:'report',characters,mode,atEnd,document,...report});
            }
          }
        }
    """

os.environ.update(GDK_BACKEND="broadway", BROADWAY_DISPLAY=f":{args.display}",
                  WEBKIT_DISABLE_COMPOSITING_MODE="1")
reports = []
failed = False
server = subprocess.Popen(["broadwayd", f":{args.display}", f"--port={args.port}"],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
if server.poll() is not None:
    raise RuntimeError("Broadway failed to start; select a free --display and --port")
# PyGObject's Gtk override parses sys.argv at import; our own --display option
# is a numeric Broadway ID, not the GTK display name it expects.
sys.argv = sys.argv[:1]
try:
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import Gtk, WebKit2, Gdk, GLib
    if not Gtk.init_check([])[0]:
        raise RuntimeError("GTK could not connect to the Broadway display")
except BaseException:
    server.terminate()
    server.wait(timeout=5)
    raise

def evaluate(script):
    def finished(view, result, unused):
        try:
            view.evaluate_javascript_finish(result)
        except Exception as error:
            print(f"Evaluation failed: {error}", flush=True)
    view.evaluate_javascript(script, -1, None, None, None, finished, None)

def on_message(manager, message):
    global failed
    data = json.loads(message.get_js_value().to_string())
    if data["type"] == "typing":
        count = 0
        def key():
            nonlocal count
            for kind in [Gdk.EventType.KEY_PRESS, Gdk.EventType.KEY_RELEASE]:
                event = Gdk.Event.new(kind)
                event.window = view.get_window()
                event.keyval = Gdk.KEY_x
                event.hardware_keycode = 53
                event.time = Gdk.CURRENT_TIME
                event.send_event = True
                view.event(event)
            count += 1
            if count == 24:
                GLib.timeout_add(100, lambda: (evaluate("window.endTyping()"), False)[1])
                return False
            return True
        GLib.timeout_add(80, key)
    elif data["type"] == "report":
        reports.append(data)
        (output / "report.json").write_text(json.dumps(reports, indent=2))
        print(json.dumps(data), flush=True)
    else:
        failed = data["type"] != "done"
        print(json.dumps(data), flush=True)
        Gtk.main_quit()

def loaded(view, event):
    if event != WebKit2.LoadEvent.FINISHED:
        return
    evaluate("void (async () => { const send = value => "
             "window.webkit.messageHandlers.profile.postMessage(JSON.stringify(value));"
             "try {" + driver + "send({type:'done'}); } "
             "catch(error) {send({type:'error',error:String(error),stack:error.stack});} })();")

def timeout():
    global failed
    failed = True
    print("Profile timed out", flush=True)
    Gtk.main_quit()
    return False

try:
    manager = WebKit2.UserContentManager()
    manager.register_script_message_handler("profile")
    manager.connect("script-message-received::profile", on_message)
    view = WebKit2.WebView(user_content_manager=manager)
    window = Gtk.Window()
    window.set_default_size(1100, 800)
    window.add(view)
    window.show_all()
    view.grab_focus()
    view.connect("load-changed", loaded)
    view.load_uri(fixture.as_uri())
    GLib.timeout_add_seconds(180, timeout)
    Gtk.main()
finally:
    server.terminate()
    server.wait(timeout=5)
print(output / "report.json")
raise SystemExit(1 if failed else 0)
