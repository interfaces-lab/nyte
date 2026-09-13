on run argv
	set needle to item 1 of argv
	set out to ""
	tell application "System Events"
		tell (first process whose name contains "Electron")
			set els to entire contents of window 1
			repeat with e in els
				try
					set r to role of e
					set nm to ""
					try
						set nm to (name of e) as text
					end try
					set ds to ""
					try
						set ds to (description of e) as text
					end try
					set vl to ""
					try
						set vl to (value of e) as text
					end try
					set hay to nm & "|" & ds & "|" & vl
					if hay contains needle then
						set p to position of e
						set s to size of e
						set out to out & r & " :: " & nm & " :: " & ds & " :: " & vl & " :: " & (item 1 of p) & "," & (item 2 of p) & " " & (item 1 of s) & "x" & (item 2 of s) & linefeed
					end if
				end try
			end repeat
		end tell
	end tell
	return out
end run
