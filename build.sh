FROM="src/routes/tests/+page.svelte"
TO="src/routes/tests/_page.svelte"

if [ -f $FROM ] 
  then mv $FROM $TO
fi

npm run build
rm -rf build/_app
cp build/* release/

if [ -f $TO ] 
  then mv $TO $FROM
fi