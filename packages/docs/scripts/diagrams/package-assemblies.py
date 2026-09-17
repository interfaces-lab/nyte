"""Generate transparent technical assemblies for the eight package sections.

Paired forms, three-layer stacks, and branching connections came from patterns
in a one-time random alphanumeric prompt. The prompt is not part of the artwork.
Run from any directory to update both inline and downloadable SVGs.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INK = "var(--nyte-color-accent)"
parts = []


def path(points, fill='none', opacity=1, dash=False, width=1.25):
    d = 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x,y in points)
    parts.append(f'<path d="{d}" fill="{fill}" stroke-width="{width}" opacity="{opacity}"' + (' stroke-dasharray="3 4"' if dash else '') + '/>')


def line(a,b,**kw):
    path([a,b],**kw)


def rect(x, y, w, h, opacity=1):
    path([(x,y),(x+w,y),(x+w,y+h),(x,y+h),(x,y)],opacity=opacity)


def node(x, y, r=2.5):
    parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{INK}" stroke="none"/>')


def schema():
    # Two contract sheets with just enough structure to read at thumbnail size.
    path([(65,42),(65,29),(158,29),(158,129),(145,129)],opacity=.4)
    rect(52,42,93,100)
    for y,w in [(61,48),(82,60),(101,42),(120,53)]:
        rect(64,y-3,6,6,opacity=.65)
        line((79,y),(79+w,y),opacity=.75)


def ai():
    # A pair of processor packages with visible pins and a central die.
    for x,y,size,alpha in [(111,38,48,.45),(56,70,58,1)]:
        rect(x,y,size,size,alpha)
        rect(x+size*.27,y+size*.27,size*.46,size*.46,alpha)
        for t in [.22,.41,.60,.79]:
            offset=size*t
            for a,b in [((x+offset,y-7),(x+offset,y)),
                        ((x+offset,y+size),(x+offset,y+size+7)),
                        ((x-7,y+offset),(x,y+offset)),
                        ((x+size,y+offset),(x+size+7,y+offset))]:
                line(a,b,opacity=alpha)


def core():
    # A tesseract projection: two cubes and eight matching-vertex connections.
    vertices=[(x,y,z) for x in [-1,1] for y in [-1,1] for z in [-1,1]]
    def project(vertex, scale):
        x,y,z=vertex
        return (110+scale*(x*37+z*20),86+scale*(y*42-z*15))
    for scale,alpha in [(1,1),(.45,.75)]:
        for i,a in enumerate(vertices):
            for b in vertices[i+1:]:
                if sum(u!=v for u,v in zip(a,b))==1:
                    line(project(a,scale),project(b,scale),opacity=alpha)
    for vertex in vertices:
        line(project(vertex,1),project(vertex,.45),opacity=.5)


def ui():
    # Four simple reusable interface blocks.
    rect(50,39,40,94)
    rect(101,39,69,26)
    rect(101,76,29,57)
    rect(141,76,29,57)
    for y in [55,73,91]:
        line((61,y),(79,y),opacity=.5)


def plugin():
    # One module attached to a socket.
    rect(53,68,57,57)
    rect(134,47,32,32)
    path([(110,96),(150,96),(150,79)],opacity=.65)
    for y in [82,96,110]:
        line((45,y),(53,y))
    for x in [143,157]:
        line((x,39),(x,47))
    rect(69,84,25,25,opacity=.5)


def telemetry():
    # A single time series, with restrained horizontal reference lines.
    path([(48,37),(48,130),(175,130)],opacity=.55)
    for y in [65,96]:
        line((48,y),(175,y),opacity=.16)
    series=[(49,111),(70,101),(87,110),(108,78),(127,87),(148,56),(173,43)]
    path(series,width=2)
    node(*series[-1],r=3)


def terminal():
    # One terminal window, viewed straight on.
    rect(44,40,132,94)
    line((44,57),(176,57),opacity=.5)
    for x in [54,62,70]:
        node(x,49,r=1.4)
    path([(60,76),(68,83),(60,90)],width=1.8)
    line((77,90),(89,90),width=2)
    line((60,109),(122,109),opacity=.35)


def desktop():
    # A monitor with a small app window and a desktop taskbar.
    rect(43,35,134,88)
    line((43,111),(177,111),opacity=.5)
    rect(80,51,76,46,opacity=.65)
    line((80,62),(156,62),opacity=.4)
    for y in [53,72]:
        rect(54,y,10,10,opacity=.5)
    line((104,123),(104,139))
    line((116,123),(116,139))
    line((87,139),(133,139))


for name,draw in [('schema',schema),('ai',ai),('core',core),('ui',ui),('plugin',plugin),('telemetry',telemetry),('terminal',terminal),('desktop',desktop)]:
    parts=[]
    draw()
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 8 180 156" fill="none" stroke="{INK}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\n'+'\n'.join(parts)+'\n</svg>\n'
    for folder in ['src/diagrams','public/diagrams']:
        (ROOT/folder/f'package-{name}.svg').write_text(svg)
