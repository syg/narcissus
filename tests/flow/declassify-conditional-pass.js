function test() {
    var x = <HU>true;
    var y;
    if (declassify(x, <LU>)) {
        y = false;
    }
}
test();
