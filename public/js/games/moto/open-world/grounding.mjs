/** Height of the actual rendered plane triangles, including their diagonal and Float32 rounding.
 * x/z are relative to the grid centre. Used only for scenery, never bike collision. */
export function gridHeight(position,width,depth,segments,x,z){
 const gx=Math.max(0,Math.min(segments-1e-7,(x/width+.5)*segments));
 const gz=Math.max(0,Math.min(segments-1e-7,(z/depth+.5)*segments));
 const ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,row=segments+1;
 const a=position[(iz*row+ix)*3+1],b=position[((iz+1)*row+ix)*3+1];
 const c=position[((iz+1)*row+ix+1)*3+1],d=position[(iz*row+ix+1)*3+1];
 return u+v<=1?a+(d-a)*u+(b-a)*v:c+(b-c)*(1-u)+(d-c)*(1-v);
}
