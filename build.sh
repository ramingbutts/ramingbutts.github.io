#!/bin/sh
# Converts Markdown posts to HTML and rebuilds the index.
# Usage: ./build.sh

set -e

SITE="site/posts"
TEMPLATE="templates/post.html"

mkdir -p "$SITE"

# --- Minimal Markdown-to-HTML via sed ---
md2html() {
    sed '
        /^```/{
            s/^```.*/<pre>/
            :code
            n
            /^```/{
                s/.*/<\/pre>/
                b
            }
            b code
        }
        s/^### \(.*\)/<h3>\1<\/h3>/
        s/^## \(.*\)/<h2>\1<\/h2>/
        s/^# \(.*\)/<h1>\1<\/h1>/
        s/^---$/<hr>/
        s/^- \(.*\)/<li>\1<\/li>/
        s/\*\*\([^*]*\)\*\*/<strong>\1<\/strong>/g
        s/\*\([^*]*\)\*/<em>\1<\/em>/g
        s/`\([^`]*\)`/<code>\1<\/code>/g
        s/\[\([^]]*\)\](\([^)]*\))/<a href="\2">\1<\/a>/g
        /^$/!{
            /^<[a-z]/!{
                s/^/<p>/
                s/$/<\/p>/
            }
        }
        /^$/d
    '
}

# --- Extract metadata from post header ---
get_meta() {
    sed -n "s/^$1: *//p" "$2" | head -1
}

# --- Extract body (everything after ---) ---
get_body() {
    sed '1,/^---$/d' "$1"
}

# --- Render template: replace placeholders with values ---
render_template() {
    _title="$1"
    _date="$2"
    _body_file="$3"
    _template="$4"

    awk -v title="$_title" -v date="$_date" -v bodyfile="$_body_file" '
    {
        if (index($0, "{{BODY}}")) {
            while ((getline line < bodyfile) > 0) print line
            close(bodyfile)
        } else {
            gsub(/\{\{TITLE\}\}/, title)
            gsub(/\{\{DATE\}\}/, date)
            print
        }
    }' "$_template"
}

# --- Build each post ---
post_index=""

for post in posts/*.md; do
    [ -f "$post" ] || continue

    slug=$(basename "$post" .md)
    title=$(get_meta title "$post")
    date=$(get_meta date "$post")
    outfile="$SITE/$slug.html"

    body_tmp=$(mktemp)
    get_body "$post" | md2html > "$body_tmp"

    render_template "$title" "$date" "$body_tmp" "$TEMPLATE" > "$outfile"
    rm -f "$body_tmp"

    post_index="$post_index<li><span class=\"post-date\">$date</span> <a href=\"site/posts/$slug.html\">$title</a></li>\n"
    echo "$slug -> $outfile"
done

# --- Rebuild index.html post listing ---
if [ -n "$post_index" ]; then
    awk -v posts="$post_index" '
    /<!-- POSTS -->/ {
        print
        printf "<ul class=\"post-list\">\n"
        printf posts
        printf "</ul>\n"
        skip = 1
        next
    }
    /<!-- \/POSTS -->/ {
        skip = 0
    }
    !skip { print }
    ' index.html > index.html.tmp && mv index.html.tmp index.html

    echo "index.html updated"
fi

echo "done."
