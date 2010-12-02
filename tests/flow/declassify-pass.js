function test() {
    var x = <HU>true;
    var y;
    if (x) {
        y = declassify(true, <LU>);
    }
}
test();
